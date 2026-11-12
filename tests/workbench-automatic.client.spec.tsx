// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FormBroker } from '../src/broker.ts'
import { Assistant } from '../src/client/Assistant.tsx'
import { startAutomatic } from '../src/client/automatic.ts'
import { JSDOM } from 'jsdom'

let broker: FormBroker; let ctx: Context; let session: { sessionId: string; ctx: object }; let stop: (() => void) | undefined
const signal = () => new AbortController().signal
let documents: JSDOM[]
beforeEach(() => {
  documents = []
  broker = new FormBroker(8000); session = { sessionId: 's1', ctx: {} }
  ctx = { uiWorkspace: { currentSession: () => session }, conversation: { input: { requestDraftInitialization: vi.fn() } } } as unknown as Context
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    if (url.endsWith('/bind')) return Response.json(broker.bind(body.sessionId, body.descriptor, body.automatic, body.clientVersion))
    if (url.endsWith('/poll')) return Response.json({ task: broker.poll(body.formRef, body.secret) })
    if (url.endsWith('/pause') || url.endsWith('/resume')) { broker.pause(body.formRef, body.secret, url.endsWith('/pause')); return Response.json({ ok: true }) }
    if (url.endsWith('/result')) { broker.result(body.formRef, body.secret, body.taskId, body.result); return Response.json({ ok: true }) }
    if (url.endsWith('/release')) { broker.close(body.formRef, body.secret); return Response.json({ ok: true }) }
    throw new Error('Unexpected path')
  })
})
afterEach(async () => { stop?.(); stop = undefined; cleanup(); await Promise.resolve(); broker.dispose(); document.body.innerHTML = ''; for (const dom of documents) dom.window.close(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function loadedDocument(iframe: HTMLIFrameElement, url = 'http://localhost/enwork/fixture/app/#/') {
  const dom = new JSDOM('<body></body>', { url }); documents.push(dom)
  vi.spyOn(dom.window.HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  vi.spyOn(dom.window.document, 'readyState', 'get').mockReturnValue('complete')
  vi.spyOn(iframe, 'contentDocument', 'get').mockReturnValue(dom.window.document)
  return dom
}
function frame(owner: string | undefined, title: string, loaded = true) {
  const wrapper = document.createElement('div')
  if (owner) wrapper.setAttribute('data-sidebar-right-session', owner)
  document.body.append(wrapper)
  const iframe = document.createElement('iframe'); iframe.title = title; wrapper.append(iframe)
  const rect = { x: 0, y: 0, top: 0, left: 0, bottom: 300, right: 400, width: 400, height: 300, toJSON() {} }
  vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue(rect)
  const view = iframe.contentWindow as Window & typeof globalThis
  vi.spyOn(view.HTMLElement.prototype, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
  if (loaded) loadedDocument(iframe)
  return iframe
}
it('cancels an in-flight selection before unlocking, stays paused, then requires explicit resumption and a fresh form', async () => {
  const iframe = frame('s1', '接管测试'), doc = iframe.contentDocument!
  doc.body.innerHTML = '<form aria-label="类别表单"><label>类别<select><option value="">请选择</option></select></label></form>'
  stop = startAutomatic(ctx)
  await waitFor(() => expect(broker.targets('s1')).toHaveLength(1))
  const ref = broker.resolve('s1')
  await broker.invoke(ref, 's1', 'inspect', [], signal())
  const pending = broker.invoke(ref, 's1', 'fill', [{ fieldId: 'f1', value: 'service' }], signal())
  const takeOver = await screen.findByRole('button', { name: '停止并接管' }, { timeout: 3000 })
  expect(iframe.style.pointerEvents).toBe('none')
  fireEvent.click(takeOver)
  const cancelled = await pending as { error: string }
  expect(cancelled.error).toMatch(/接管|停止/u)
  await screen.findByRole('button', { name: '允许 Agent 继续' })
  expect(iframe.style.pointerEvents).toBe('')
  expect(doc.querySelector('select')!.value).toBe('')
  expect(() => broker.invoke(ref, 's1', 'fill', [{ fieldId: 'f1', value: 'service' }], signal())).toThrow('接管')
  fireEvent.click(screen.getByRole('button', { name: '允许 Agent 继续' }))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Agent 网页操作状态' })).toBeNull())
  await broker.invoke(ref, 's1', 'inspect', [], signal())
  doc.querySelector('select')!.insertAdjacentHTML('beforeend', '<option value="service">服务</option>')
  const result = await broker.invoke(ref, 's1', 'fill', [{ fieldId: 'f1', value: 'service' }], signal()) as { fields: { status: string }[] }
  expect(result.fields[0]!.status).toBe('filled')
  await broker.invoke(ref, 's1', 'page', [], signal(), undefined, { action: 'finish' })
  expect(iframe.style.pointerEvents).toBe('')
})
it('waits when src is assigned after mount, then observes the loaded document and SPA navigation without stale blank metadata', async () => {
  const iframe = frame('s1', '延迟加载投标工作台', false)
  stop = startAutomatic(ctx)
  await new Promise(resolve => setTimeout(resolve, 1100))
  expect(broker.targets('s1')).toEqual([])
  iframe.setAttribute('src', '/enwork/bid/app/#/')
  const dom = loadedDocument(iframe, 'http://localhost/enwork/bid/app/#/')
  dom.window.document.body.innerHTML = '<button type="button">新增招标意向</button>'
  iframe.dispatchEvent(new Event('load'))
  await waitFor(() => expect(broker.targets('s1')).toHaveLength(1), { timeout: 3000 })
  const target = broker.targets('s1')[0]!
  expect(target.page).toBe('/enwork/bid/app/#/')
  expect(target.clientVersion).toBe('0.7.0')
  dom.window.history.replaceState({}, '', '/enwork/bid/app/#/intent')
  const snapshot = await broker.invoke(target.formRef, 's1', 'page', [], signal(), undefined, { action: 'snapshot' }) as { page: string; elements: unknown[] }
  expect(snapshot.page).toBe('/enwork/bid/app/#/intent')
  expect(snapshot.elements).toHaveLength(1)
  expect(broker.targets('s1')[0]!.page).toBe('/enwork/bid/app/#/intent')
})
it('registers an actual desktop-scheme page and snapshots its controls', async () => {
  const iframe = frame('s1', '桌面投标工作台', false)
  const dom = loadedDocument(iframe, 'dsh-app://app/enwork/bid/app/#/market/intent')
  dom.window.document.body.innerHTML = '<button type="button">新增招标意向</button>'
  stop = startAutomatic(ctx)
  await waitFor(() => expect(broker.targets('s1')).toHaveLength(1))
  const target = broker.targets('s1')[0]!
  const snapshot = await broker.invoke(target.formRef, 's1', 'page', [], signal(), undefined, { action: 'snapshot' }) as { elements: { name: string }[] }
  expect(snapshot.elements[0]!.name).toBe('新增招标意向')
})
it('automatically discovers the right-hand workbench and clicks 新增招标意向 before filling, without a launcher or draft edit', async () => {
  const iframe = frame('s1', '百诺投标工作台'), doc = iframe.contentDocument!
  doc.body.innerHTML = '<button type="button">新增招标意向</button>'
  const click = vi.fn(() => { doc.body.innerHTML = '<form aria-label="新增招标意向"><label>项目名称<input name="name"></label><label>预算（元）<input type="number"></label></form>' })
  doc.querySelector('button')!.onclick = click
  render(<Assistant ctx={ctx} launcher={false} />)
  stop = startAutomatic(ctx)
  await waitFor(() => expect(broker.targets('s1')).toHaveLength(1))
  expect(document.querySelector('aside')).toBeNull()
  expect(document.body.textContent).not.toContain('工作台浏览器助手')
  expect(click).not.toHaveBeenCalled()
  expect(ctx.conversation.input.requestDraftInitialization).not.toHaveBeenCalled()
  expect(JSON.stringify(broker.targets('s1'))).not.toContain('secret')
  const ref = broker.resolve('s1')
  const snapshot = await broker.invoke(ref, 's1', 'page', [], signal(), undefined, { action: 'snapshot' }) as { elements: { nodeRef: string; name: string }[] }
  const create = snapshot.elements.find(element => element.name === '新增招标意向')!
  const next = await broker.invoke(ref, 's1', 'page', [], signal(), undefined, { action: 'click', nodeRef: create.nodeRef }) as { forms: { nodeRef: string }[] }
  expect(click).toHaveBeenCalledTimes(1)
  await broker.invoke(ref, 's1', 'page', [], signal(), undefined, { action: 'form', nodeRef: next.forms[0]!.nodeRef })
  const result = await broker.invoke(ref, 's1', 'fill', [{ fieldId: 'f1', value: '环境影响报告书编制' }, { fieldId: 'f2', value: '500000' }], signal()) as { fields: { status: string }[] }
  expect(result.fields.map(field => field.status)).toEqual(['filled', 'filled'])
  expect(doc.querySelector('input')!.value).toBe('环境影响报告书编制')
  expect(doc.querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe('500000')
  expect(ctx.conversation.input.requestDraftInitialization).not.toHaveBeenCalled()
})
it('isolates chat-owned pages, rejects ambiguous automatic selection, and releases old tasks when the chat changes', async () => {
  frame('s1', '投标'); const second = frame('s1', '合同'); frame('s2', '另一聊天'); frame(undefined, '不属于聊天的主栏网页')
  stop = startAutomatic(ctx)
  await waitFor(() => expect(broker.targets('s1')).toHaveLength(2))
  expect(broker.targets('s2')).toEqual([])
  expect(() => broker.resolve('s1')).toThrow('多个网页')
  second.hidden = true
  await waitFor(() => expect(broker.targets('s1')).toHaveLength(1), { timeout: 3000 })
  const ref = broker.resolve('s1')
  const pending = broker.invoke(ref, 's1', 'page', [], signal(), undefined, { action: 'wait' })
  const assertion = expect(pending).rejects.toThrow('已关闭')
  session = { sessionId: 's2', ctx: {} }
  await assertion
  await waitFor(() => expect(broker.targets('s2')).toHaveLength(1), { timeout: 3000 })
  expect(broker.targets('s1')).toEqual([])
  expect(() => broker.resolve('s2', ref)).toThrow()
})
