// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WorkbenchPage } from '../src/client/page.ts'
import { JSDOM } from 'jsdom'
let frame: HTMLIFrameElement
beforeEach(() => {
  frame = document.createElement('iframe'); document.body.append(frame)
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  const view = frame.contentWindow as Window & typeof globalThis
  vi.spyOn(view.HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
})
afterEach(() => { frame.remove(); vi.restoreAllMocks() })
it('does not capture an initial about:blank document before a real workbench loads', () => {
  const original = frame.getAttribute.bind(frame)
  vi.spyOn(frame, 'getAttribute').mockImplementation(name => name === 'src' ? '/enwork/bid/app/#/' : original(name))
  expect(() => new WorkbenchPage({ frame, title: '投标' })).toThrow('正在加载')
  const loaded = new JSDOM('<body>投标工作台</body>', { url: 'http://localhost/enwork/bid/app/#/' })
  vi.spyOn(frame, 'contentDocument', 'get').mockReturnValue(loaded.window.document)
  const page = new WorkbenchPage({ frame, title: '投标' })
  expect(() => page.assertCurrent()).not.toThrow()
  loaded.window.history.replaceState({}, '', '/enwork/bid/app/#/intent/new')
  expect(() => page.assertCurrent()).not.toThrow()
  loaded.window.history.replaceState({}, '', '/enwork/another/app/')
  expect(() => page.assertCurrent()).toThrow('离开关联的工作台范围')
  loaded.window.close()
})
it('navigates an existing iframe menu, discovers a later form, fills it and rejects old refs', async () => {
  const doc = frame.contentDocument!
  doc.body.innerHTML = '<button type="button">合同登记</button><div id="content"></div>'
  doc.querySelector('button')!.onclick = () => {
    doc.getElementById('content')!.innerHTML = '<form aria-label="新建合同"><label>名称<input name="name"></label><label>分类<select><option value="">请选择</option><option value="service">服务</option></select></label><button>提交</button></form>'
  }
  const page = new WorkbenchPage({ frame, title: '合同工作台' })
  const before = page.snapshot()
  expect(before.forms).toHaveLength(0)
  const after = await page.execute({ action: 'click', nodeRef: before.elements[0]!.nodeRef }) as ReturnType<WorkbenchPage['snapshot']>
  expect(after.forms).toHaveLength(1)
  await expect(page.execute({ action: 'click', nodeRef: before.elements[0]!.nodeRef })).rejects.toThrow('引用已变化')
  const descriptor = await page.execute({ action: 'form', nodeRef: after.forms[0]!.nodeRef })
  expect(descriptor).toMatchObject({ fields: [{ label: '名称' }, { label: '分类' }] })
  const result = await page.live!.apply([{ fieldId: 'f1', value: '园区合同' }, { fieldId: 'f2', value: 'service' }])
  expect(result.fields.map(field => field.status)).toEqual(['filled', 'filled'])
  expect(doc.querySelector('input')!.value).toBe('园区合同')
  expect(doc.querySelector('select')!.value).toBe('service')
  doc.querySelector('form')!.innerHTML = '<label>其他字段<input></label>'
  await expect(page.live!.apply([{ fieldId: 'f1', value: '不应写入' }])).rejects.toThrow('字段已变化')
})
it('limits observation and control to the selected iframe and rejects commit/new-window/script links', async () => {
  document.body.insertAdjacentHTML('beforeend', '<button id="outer">Host token management</button>')
  const doc = frame.contentDocument!
  doc.body.innerHTML = '<button type="button">保存</button><a href="javascript:alert(1)">脚本</a><a href="https://example.com/" target="_blank">新窗口</a><p hidden>HIDDEN SECRET</p><input type="password" value="SECRET">'
  const page = new WorkbenchPage({ frame, title: '测试' })
  const snapshot = page.snapshot()
  expect(JSON.stringify(snapshot)).not.toContain('Host token')
  expect(JSON.stringify(snapshot)).not.toContain('SECRET')
  for (const element of snapshot.elements) await expect(page.execute({ action: 'click', nodeRef: element.nodeRef })).rejects.toThrow()
  await expect(page.execute({ action: 'navigate', url: 'https://example.com/' })).rejects.toThrow('工作台应用范围')
  frame.hidden = true
  expect(() => page.snapshot()).toThrow('已关闭或隐藏')
  document.getElementById('outer')!.remove()
})
it('rejects a reused DOM node whose action changed since observation', async () => {
  frame.contentDocument!.body.innerHTML = '<button type="button">新建</button>'
  const page = new WorkbenchPage({ frame, title: '测试' })
  const snapshot = page.snapshot()
  frame.contentDocument!.querySelector('button')!.textContent = '支付'
  await expect(page.execute({ action: 'click', nodeRef: snapshot.elements[0]!.nodeRef })).rejects.toThrow('引用已变化')
})
