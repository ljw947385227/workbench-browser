// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preferredFrame, scanFrames, watchFrames } from '../src/client/frames.ts'
import { LiveForm } from '../src/client/dom.ts'
const rect = { x: 0, y: 0, top: 0, left: 0, bottom: 300, right: 400, width: 400, height: 300, toJSON() {} }
function geometry(view: Window & typeof globalThis) {
  vi.spyOn(view.HTMLElement.prototype, 'getClientRects').mockReturnValue([rect] as unknown as DOMRectList)
  vi.spyOn(view.HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect)
}
function frame(parent: Document = document, title = '没有接入代码的合同工作台') {
  const element = parent.createElement('iframe'); element.title = title; parent.body.append(element)
  geometry(element.contentWindow as Window & typeof globalThis)
  element.contentDocument!.body.innerHTML = '<form aria-label="合同登记"><label>合同名称<input name="name"></label></form>'
  return element
}
beforeEach(() => { geometry(window) })
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; vi.restoreAllMocks() })
describe('automatic workbench iframe discovery', () => {
  it('discovers an unrelated unregistered iframe without a workbench activation event', () => {
    const element = frame()
    const candidates = scanFrames(document)
    expect(candidates).toHaveLength(1); expect(candidates[0]).toMatchObject({ frame: element, title: element.title, accessible: true })
    expect(candidates[0].forms).toHaveLength(1)
    expect(preferredFrame(candidates)?.frame).toBe(element)
    expect(JSON.stringify(candidates.map(({ title, accessible }) => ({ title, accessible })))).not.toContain('value')
  })
  it('excludes hidden workspaces, invisible ancestors and offscreen utility frames', () => {
    const a = frame(); a.hidden = true
    const b = frame(); const wrapper = document.createElement('div'); wrapper.style.display = 'none'; document.body.append(wrapper); wrapper.append(b)
    const c = frame(); vi.spyOn(c, 'getBoundingClientRect').mockReturnValue({ ...rect, top: -900, bottom: -600 })
    expect(scanFrames(document)).toEqual([])
  })
  it('reports blocked frames while retaining readable workbenches', () => {
    const blocked = frame(document, '跨域工作台'); Object.defineProperty(blocked, 'contentDocument', { configurable: true, get: () => { throw new DOMException('Blocked', 'SecurityError') } })
    const available = frame(document, '可读工作台')
    const candidates = scanFrames(document)
    expect(candidates.find(candidate => candidate.frame === blocked)).toMatchObject({ accessible: false, forms: [], reason: expect.stringContaining('禁止读取') })
    expect(preferredFrame(candidates)?.frame).toBe(available)
  })
  it('requires a choice when multiple unregistered pages contain forms', () => {
    frame(document, '合同'); frame(document, '费用')
    expect(preferredFrame(scanFrames(document))).toBeUndefined()
  })
  it('discovers nested frames and invalidates a live target when an ancestor hides', () => {
    const outer = frame(document, '外层工作台'); const inner = frame(outer.contentDocument!, '内层网页')
    const candidates = scanFrames(document)
    const selected = candidates.find(candidate => candidate.frame === inner)!
    expect(selected.forms).toHaveLength(1)
    const live = new LiveForm({ frame: inner, title: '内层网页' }, selected.forms[0])
    outer.hidden = true
    expect(scanFrames(document)).toEqual([]); expect(() => live.describe()).toThrow('网页已切换')
  })
  it('updates for mounted, replaced and removed forms, and disconnects observers on stop', async () => {
    vi.useFakeTimers()
    const changed = vi.fn(); const stop = watchFrames(document, changed)
    const element = frame()
    await vi.advanceTimersByTimeAsync(1600)
    expect(changed.mock.calls.at(-1)![0][0].frame).toBe(element)
    const previous = changed.mock.calls.at(-1)![0][0].forms[0]
    element.contentDocument!.body.innerHTML = '<form><label>新字段<input></label></form>'
    await vi.advanceTimersByTimeAsync(1600)
    expect(changed.mock.calls.at(-1)![0][0].forms[0]).not.toBe(previous)
    element.remove(); await vi.advanceTimersByTimeAsync(1600)
    expect(changed.mock.calls.at(-1)![0]).toEqual([])
    stop(); const count = changed.mock.calls.length; frame(); await vi.advanceTimersByTimeAsync(2000)
    expect(changed).toHaveBeenCalledTimes(count)
  })
})
