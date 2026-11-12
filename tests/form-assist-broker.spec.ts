import { describe, expect, it } from 'vitest'
import { FormBroker } from '../src/broker.ts'
const descriptor = { title: 'Fixture', page: '/form', fields: [{ fieldId: 'f1', label: '名称', type: 'text', required: true, value: '' }] }
describe('form assistant conversation and delivery boundaries', () => {
  it('routes to its owner, requires browser secret and never issues a task twice', async () => {
    const broker = new FormBroker(); const key = broker.bind('session-a', descriptor)
    expect(() => broker.invoke(key.formRef, 'session-b', 'inspect', [], new AbortController().signal)).toThrow('另一个对话')
    expect(() => broker.poll(key.formRef, 'wrong')).toThrow('无权访问')
    const pending = broker.invoke(key.formRef, 'session-a', 'fill', [{ fieldId: 'f1', value: 'example' }], new AbortController().signal)
    const task = broker.poll(key.formRef, key.secret)!
    expect(task.action).toBe('fill'); expect(broker.poll(key.formRef, key.secret)).toBeNull()
    expect(() => broker.result(key.formRef, key.secret, 'wrong', {})).toThrow('已结束')
    broker.result(key.formRef, key.secret, task.id, { filled: true })
    expect(await pending).toEqual({ filled: true }); broker.dispose()
  })
  it('rejects cancelled and late tasks without replaying a write', async () => {
    const broker = new FormBroker(); const key = broker.bind('s', descriptor); const controller = new AbortController()
    const pending = broker.invoke(key.formRef, 's', 'fill', [{ fieldId: 'f1', value: 'x' }], controller.signal)
    const assertion = expect(pending).rejects.toThrow('已取消')
    const task = broker.poll(key.formRef, key.secret)!
    controller.abort(); await assertion
    expect(broker.poll(key.formRef, key.secret)).toBeNull()
    expect(() => broker.result(key.formRef, key.secret, task.id, {})).toThrow('已结束'); broker.dispose()
  })
  it('releases pending calls on close and rejects unknown or duplicate fields', async () => {
    const broker = new FormBroker(); const key = broker.bind('s', descriptor)
    expect(() => broker.invoke(key.formRef, 's', 'fill', [{ fieldId: 'f9', value: 'x' }], new AbortController().signal)).toThrow('无效')
    expect(() => broker.invoke(key.formRef, 's', 'fill', [{ fieldId: 'f1', value: 'x' }, { fieldId: 'f1', value: 'y' }], new AbortController().signal)).toThrow('重复')
    const pending = broker.invoke(key.formRef, 's', 'inspect', [], new AbortController().signal)
    const assertion = expect(pending).rejects.toThrow('已关闭')
    broker.close(key.formRef, key.secret); await assertion
    expect(() => broker.poll(key.formRef, key.secret)).toThrow('已失效')
  })
  it('times out calls and cleans pending state', async () => {
    const broker = new FormBroker(20); const key = broker.bind('s', descriptor)
    await expect(broker.invoke(key.formRef, 's', 'inspect', [], new AbortController().signal)).rejects.toThrow('超时')
    expect(broker.poll(key.formRef, key.secret)).toBeNull(); broker.dispose()
  })
})
