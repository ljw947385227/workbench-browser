import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/index.ts'
interface Route { handler(req: IncomingMessage, res: ServerResponse): void }
let context: Context; let server: Server; let origin: string; let route: Route; let rejected: boolean
let tool: { name: string; execute(args: unknown, exec: unknown): Promise<string> }
let pageTool: typeof tool
const descriptor = { title: 'Fixture', page: '/form', fields: [{ fieldId: 'f1', label: '名称', type: 'text', required: true, value: '' }] }
beforeEach(async () => {
  rejected = false; context = new Context()
  context.provide('webServer', { register(value: Route) { route = value; return () => {} } } as never)
  context.provide('connection', { requestRejection: () => rejected ? 403 : undefined } as never)
  context.provide('tools', { register(value: typeof tool) { if (value.name === 'workbench_browser') pageTool = value; else tool = value; return () => {} } } as never)
  context.provide('systemPrompt', { getSectionOrder: () => 0, section: () => () => {} } as never)
  await context.plugin({ apply, inject, name }).await()
  server = createServer((req, res) => route.handler(req, res))
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}/enwork/form-assistant`
})
afterEach(async () => { await context.fiber.dispose(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) })
const call = (path: string, data: unknown) => fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
describe('installable plugin Host transport and real registered tool', () => {
  it('discovers automatic right-hand pages and executes snapshot without a manually pasted reference', async () => {
    const key = await (await call('/bind', { sessionId: 'chat-1', automatic: true, descriptor: { ...descriptor, fields: [] } })).json()
    const exec = { agent: { session: { id: 'chat-1' } }, signal: new AbortController().signal }
    const targets = JSON.parse(await pageTool.execute({ action: 'targets' }, exec)).targets
    expect(targets).toEqual([{ formRef: key.formRef, title: descriptor.title, page: descriptor.page }])
    expect(JSON.stringify(targets)).not.toContain(key.secret)
    const other = { ...exec, agent: { session: { id: 'chat-2' } } }
    expect(JSON.parse(await pageTool.execute({ action: 'targets' }, other)).targets).toEqual([])
    const operation = pageTool.execute({ action: 'snapshot' }, exec)
    const { task } = await (await call('/poll', key)).json()
    expect(task.command.action).toBe('snapshot')
    await call('/result', { ...key, taskId: task.id, result: { elements: [] } })
    expect(JSON.parse(await operation)).toEqual({ elements: [] })
  })
  it('binds a page without fields, selects a later form and scopes navigation to the owning conversation', async () => {
    const key = await (await call('/bind', { sessionId: 'chat-1', descriptor: { ...descriptor, fields: [] } })).json()
    const exec = { agent: { session: { id: 'chat-1' } }, signal: new AbortController().signal }
    await expect(pageTool.execute({ formRef: key.formRef, action: 'snapshot' }, { ...exec, agent: { session: { id: 'chat-2' } } })).rejects.toThrow('另一个对话')
    const navigation = pageTool.execute({ formRef: key.formRef, action: 'click', nodeRef: 'n1' }, exec)
    const { task } = await (await call('/poll', key)).json()
    expect(task.command).toEqual({ action: 'click', nodeRef: 'n1' })
    expect((await (await call('/poll', key)).json()).task).toBeNull()
    await call('/result', { ...key, taskId: task.id, result: { forms: [{ nodeRef: 'n2' }] } })
    await navigation
    const selection = pageTool.execute({ formRef: key.formRef, action: 'form', nodeRef: 'n2' }, exec)
    const selected = await (await call('/poll', key)).json()
    await call('/result', { ...key, taskId: selected.task.id, result: descriptor })
    await selection
    const filling = tool.execute({ formRef: key.formRef, action: 'fill', assignments: [{ fieldId: 'f1', value: 'new form' }] }, exec)
    const fill = await (await call('/poll', key)).json()
    expect(fill.task.assignments[0].value).toBe('new form')
    await call('/result', { ...key, taskId: fill.task.id, result: { fields: [], missing: [] } })
    await filling
  })
  it('roundtrips model inspect/fill through browser polls and actual results', async () => {
    const key = await (await call('/bind', { sessionId: 'chat-1', descriptor })).json()
    expect(tool.name).toBe('form_assist')
    const exec = { agent: { session: { id: 'chat-1' } }, signal: new AbortController().signal }
    const pending = tool.execute({ action: 'inspect', formRef: key.formRef }, exec)
    const { task } = await (await call('/poll', key)).json()
    expect(task.action).toBe('inspect')
    await call('/result', { ...key, taskId: task.id, result: descriptor })
    expect(JSON.parse(await pending)).toEqual(descriptor)
    const readingOptions = tool.execute({ action: 'options', formRef: key.formRef, fieldId: 'f1' }, exec)
    const optionTask = await (await call('/poll', key)).json()
    expect(optionTask.task).toMatchObject({ action: 'options', fieldId: 'f1' })
    await call('/result', { ...key, taskId: optionTask.task.id, result: { options: [{ value: 'yes', label: '是' }] } })
    expect(JSON.parse(await readingOptions).options[0].label).toBe('是')
    const filling = tool.execute({ action: 'fill', formRef: key.formRef, assignments: [{ fieldId: 'f1', value: 'project' }] }, exec)
    const next = await (await call('/poll', key)).json()
    expect(next.task.assignments).toEqual([{ fieldId: 'f1', value: 'project' }])
    await call('/result', { ...key, taskId: next.task.id, result: { fields: [{ status: 'filled', value: 'project' }], missing: [] } })
    expect(JSON.parse(await filling).fields[0].value).toBe('project')
    await call('/release', key)
    await expect(tool.execute({ action: 'inspect', formRef: key.formRef }, exec)).rejects.toThrow('已失效')
  })
  it('enforces admission, malformed bodies and conversation ownership', async () => {
    rejected = true; expect((await call('/bind', {})).status).toBe(403); rejected = false
    expect((await call('/bind', {})).status).toBe(400)
    const key = await (await call('/bind', { sessionId: 'chat-1', descriptor })).json()
    expect((await call('/poll', { ...key, secret: 'wrong' })).status).toBe(400)
    await expect(tool.execute({ action: 'inspect', formRef: key.formRef }, { agent: { session: { id: 'chat-2' } }, signal: new AbortController().signal })).rejects.toThrow('另一个对话')
  })
})
