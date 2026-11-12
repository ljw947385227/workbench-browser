// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Assistant, ACTIVATE, READY } from '../src/client/Assistant.tsx'
import { FormBroker } from '../src/broker.ts'
let broker: FormBroker; let key: { formRef: string; secret: string }; let selected: object
let requestDraft: ReturnType<typeof vi.fn>; let ctx: Context
beforeEach(() => {
  broker = new FormBroker(5000); selected = { sessionId: 's1', ctx: {} }
  requestDraft = vi.fn(() => 'applied')
  ctx = { uiWorkspace: { currentSession: () => selected }, conversation: { input: { requestDraftInitialization: requestDraft, for: () => ({ focus() {} }) } } } as unknown as Context
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body))
    if (url.endsWith('/bind')) { key = broker.bind(body.sessionId, body.descriptor); return Response.json(key) }
    if (url.endsWith('/poll')) return Response.json({ task: broker.poll(body.formRef, body.secret) })
    if (url.endsWith('/result')) { broker.result(body.formRef, body.secret, body.taskId, body.result); return Response.json({ ok: true }) }
    if (url.endsWith('/release')) { broker.close(body.formRef, body.secret); return Response.json({ ok: true }) }
    throw new Error('Unexpected path')
  })
})
afterEach(async () => { cleanup(); await Promise.resolve(); broker.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function mountAndBind() {
  render(<><form aria-label='fixture' id='fixture-form'><label>联系人<input name='contact' /></label></form><Assistant ctx={ctx} /></>)
  act(() => { window.dispatchEvent(new CustomEvent(ACTIVATE, { detail: { root: document.getElementById('fixture-form'), title: 'Fixture' } })) })
  fireEvent.click(await screen.findByRole('button', { name: '关联到当前聊天' }))
  await screen.findByText('已关联。在聊天框中补充资料并发送，Agent 会调用工具填写。')
}
describe('installed assistant client workflow', () => {
  it('links an iframe before a form exists, clicks its menu, then fills the newly selected form in the same lease', async () => {
    const iframe = document.createElement('iframe'); iframe.title = '导航测试'; document.body.append(iframe)
    const rect = { x: 0, y: 0, top: 0, left: 0, bottom: 300, right: 400, width: 400, height: 300, toJSON() {} }
    vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue(rect)
    const view = iframe.contentWindow as Window & typeof globalThis
    vi.spyOn(view.HTMLElement.prototype, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
    const doc = iframe.contentDocument!
    doc.body.innerHTML = '<button type="button">新建合同</button><section></section>'
    doc.querySelector('button')!.onclick = () => { doc.querySelector('section')!.innerHTML = '<form aria-label="合同"><label>名称<input></label></form>' }
    render(<Assistant ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: /^工作台浏览器助手/ }))
    fireEvent.click(await screen.findByRole('button', { name: '关联到当前聊天' }))
    await screen.findByText('已关联。在聊天框中补充资料并发送，Agent 会调用工具填写。')
    const signal = new AbortController().signal
    const snapshot = await broker.invoke(key.formRef, 's1', 'page', [], signal, undefined, { action: 'snapshot' }) as { elements: { nodeRef: string }[] }
    const next = await broker.invoke(key.formRef, 's1', 'page', [], signal, undefined, { action: 'click', nodeRef: snapshot.elements[0]!.nodeRef }) as { forms: { nodeRef: string }[] }
    expect(next.forms).toHaveLength(1)
    await broker.invoke(key.formRef, 's1', 'page', [], signal, undefined, { action: 'form', nodeRef: next.forms[0]!.nodeRef })
    const filled = await broker.invoke(key.formRef, 's1', 'fill', [{ fieldId: 'f1', value: '新合同' }], signal) as { fields: { status: string }[] }
    expect(filled.fields[0]!.status).toBe('filled')
    expect(doc.querySelector('input')!.value).toBe('新合同')
    cleanup(); iframe.remove()
  })
  it('finds and fills an unmodified workbench iframe from its own launcher', async () => {
    const iframe = document.createElement('iframe'); iframe.title = '独立合同工作台'; document.body.append(iframe)
    const rect = { x: 0, y: 0, top: 0, left: 0, bottom: 300, right: 400, width: 400, height: 300, toJSON() {} }
    vi.spyOn(iframe, 'getBoundingClientRect').mockReturnValue(rect)
    const view = iframe.contentWindow as Window & typeof globalThis
    vi.spyOn(view.HTMLElement.prototype, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
    iframe.contentDocument!.body.innerHTML = '<form aria-label="合同登记"><label>合同名称<input name="contract"></label></form>'
    render(<Assistant ctx={ctx} />)
    fireEvent.click(screen.getByRole('button', { name: /^工作台浏览器助手/ }))
    expect(screen.getByLabelText('网页工作台')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('发现 1 张表单')
    fireEvent.click(screen.getByRole('button', { name: '关联到当前聊天' }))
    await screen.findByText('已关联。在聊天框中补充资料并发送，Agent 会调用工具填写。')
    expect(requestDraft.mock.calls[0][1].prompt.text).toContain('独立合同工作台')
    const pending = broker.invoke(key.formRef, 's1', 'fill', [{ fieldId: 'f1', value: '园区咨询合同' }], new AbortController().signal)
    const input = iframe.contentDocument!.querySelector('input')!
    await waitFor(() => expect(input.value).toBe('园区咨询合同'), { timeout: 3000 })
    expect((await pending as { fields: { status: string }[] }).fields[0].status).toBe('filled')
    cleanup(); iframe.remove()
  })
  it('links a draft without exposing the browser secret and executes model values through the broker', async () => {
    await mountAndBind()
    expect(Reflect.get(window, READY)).toBe(true)
    const draft = requestDraft.mock.calls[0][1].prompt.text
    expect(draft).toContain(key.formRef); expect(draft).not.toContain(key.secret)
    const pending = broker.invoke(key.formRef, 's1', 'fill', [{ fieldId: 'f1', value: '张三' }], new AbortController().signal)
    await waitFor(() => expect((screen.getByLabelText('联系人') as HTMLInputElement).value).toBe('张三'), { timeout: 3000 })
    expect((await pending as { fields: { status: string }[] }).fields[0].status).toBe('filled')
    const replacing = broker.invoke(key.formRef, 's1', 'fill', [{ fieldId: 'f1', value: '李四' }], new AbortController().signal)
    await screen.findByRole('button', { name: '确认替换以上 1 项' }, { timeout: 3000 })
    expect((await replacing as { fields: { status: string }[] }).fields[0].status).toBe('conflict')
    expect((screen.getByLabelText('联系人') as HTMLInputElement).value).toBe('张三')
    fireEvent.click(screen.getByRole('button', { name: '确认替换以上 1 项' }))
    await waitFor(() => expect((screen.getByLabelText('联系人') as HTMLInputElement).value).toBe('李四'))
  })
  it('refuses stale conflict approval and releases the binding when the conversation changes', async () => {
    await mountAndBind()
    fireEvent.change(screen.getByLabelText('联系人'), { target: { value: '张三' } })
    const pending = broker.invoke(key.formRef, 's1', 'fill', [{ fieldId: 'f1', value: '李四' }], new AbortController().signal)
    const approve = await screen.findByRole('button', { name: '确认替换以上 1 项' }, { timeout: 3000 }); await pending
    fireEvent.change(screen.getByLabelText('联系人'), { target: { value: '王五' } }); fireEvent.click(approve)
    expect(screen.getByRole('alert').textContent).toContain('字段已被修改')
    expect((screen.getByLabelText('联系人') as HTMLInputElement).value).toBe('王五')
    selected = { sessionId: 's2', ctx: {} }
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('当前对话已切换'), { timeout: 3000 })
    expect(() => broker.poll(key.formRef, key.secret)).toThrow('已失效')
  })
})
