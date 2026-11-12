// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { discover, LiveForm } from '../src/client/dom.ts'
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
  document.body.innerHTML = '<form aria-label="fixture"><label>名称<input name="name" required></label><label>金额（元）<input type="number" min="0" step="0.01"></label><label>类型<select><option value="">请选择</option><option value="service">服务类</option></select></label><label>开始日期<input type="date"></label><label>已阅读<input type="checkbox"></label><input type="password" value="never-expose"><input type="hidden" value="csrf"><input readonly value="readonly"><input type="file"></form>'
})
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })
const live = () => new LiveForm({ root: document.querySelector('form')!, title: 'Fixture' }, document.querySelector('form')!)
describe('live form controls', async () => {
  it('discovers only editable native fields, excluding credentials and hidden values', async () => {
    const target = { root: document.body, title: 'Fixture' }
    expect(discover(target)).toHaveLength(1)
    const snapshot = live().describe(); expect(snapshot.fields).toHaveLength(5)
    expect(snapshot.fields[0].label).toBe('名称'); expect(JSON.stringify(snapshot)).not.toContain('never-expose'); expect(JSON.stringify(snapshot)).not.toContain('csrf')
  })
  it('fills the native model with events, units, selected options, date and checkbox values', async () => {
    const form = live(); const input = document.querySelector('input')!; const inputEvent = vi.fn(); input.addEventListener('input', inputEvent)
    const result = await form.apply([{ fieldId: 'f1', value: '项目' }, { fieldId: 'f2', value: '120000' }, { fieldId: 'f3', value: 'service' }, { fieldId: 'f4', value: '2026-12-01' }, { fieldId: 'f5', value: 'true' }])
    expect(result.fields.every(field => field.status === 'filled')).toBe(true); expect(inputEvent).toHaveBeenCalledOnce(); expect(result.missing).toEqual([])
    expect(form.describe().fields.map(field => field.value)).toEqual(['项目', '120000', 'service', '2026-12-01', 'true'])
  })
  it('preserves existing values until explicit browser approval', async () => {
    const form = live(); await form.apply([{ fieldId: 'f1', value: '张三' }])
    expect((await form.apply([{ fieldId: 'f1', value: '李四' }])).fields[0].status).toBe('conflict')
    expect(form.describe().fields[0].value).toBe('张三')
    expect((await form.apply([{ fieldId: 'f1', value: '李四' }], true)).fields[0].status).toBe('filled')
  })
  it('rejects invalid numbers, dates and unavailable choices without changing the field', async () => {
    const result = await live().apply([{ fieldId: 'f2', value: '-1' }, { fieldId: 'f3', value: 'invented' }, { fieldId: 'f4', value: '2026-02-31' }])
    expect(result.fields.every(field => field.status === 'failed')).toBe(true)
    expect(live().describe().fields.slice(1, 4).map(field => field.value)).toEqual(['', '', ''])
  })
  it('invalidates a removed, hidden or dynamically replaced form', async () => {
    const form = live(); const element = document.querySelector('form')!
    element.hidden = true; expect(() => form.describe()).toThrow('网页已切换'); element.hidden = false
    element.querySelector('input')!.replaceWith(document.createElement('input')); expect(() => form.describe()).toThrow('字段已变化')
    element.remove(); expect(() => form.describe()).toThrow('网页已切换')
  })
  it('does not report a value that a page input handler discarded as successful', async () => {
    const form = live(); const input = document.querySelector('input')!
    input.addEventListener('input', async () => { input.value = '' })
    expect((await form.apply([{ fieldId: 'f1', value: 'discarded' }])).fields[0].status).toBe('failed')
  })
})
