// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { LiveForm } from '../src/client/dom.ts'
beforeEach(() => { vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList) })
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })
const live = () => new LiveForm({ root: document.querySelector('form')!, title: 'Fixture' }, document.querySelector('form')!)
function select(options = ['是', '否']) {
  document.body.innerHTML = '<form><div class="el-form-item"><label>预留中小企业采购份额</label><div class="el-select"><div class="el-select__wrapper"><input readonly role="combobox" aria-controls="choices"><div class="el-select__placeholder is-transparent">请选择</div></div></div></div></form><ul id="choices" role="listbox" hidden></ul><ul role="listbox"><li role="option">无关选项</li></ul>'
  const list = document.getElementById('choices')!, wrapper = document.querySelector<HTMLElement>('.el-select__wrapper')!
  const selected = document.querySelector<HTMLElement>('.el-select__placeholder')!
  wrapper.onclick = () => { list.hidden = !list.hidden }
  for (const option of options) { const item = document.createElement('li'); item.role = 'option'; item.textContent = option; item.onclick = () => { selected.textContent = option; selected.classList.remove('is-transparent'); list.hidden = true }; list.append(item) }
  return { list, wrapper, selected }
}
function cascader(delay = 20) {
  document.body.innerHTML = '<form><div class="el-form-item"><label>地区</label><div class="el-cascader" aria-describedby="regions"><input placeholder="请选择省 / 市 / 区县"></div></div></form><div id="regions" class="el-cascader__dropdown" hidden><ul class="el-cascader-menu__list"></ul></div>'
  const popup = document.getElementById('regions')!, root = document.querySelector<HTMLElement>('.el-cascader')!, input = root.querySelector('input')!
  root.onclick = () => { popup.hidden = !popup.hidden }
  const clicked: string[] = []
  const level = (name: string, depth: number) => {
    const node = document.createElement('li'); node.className = 'el-cascader-node'; node.role = 'menuitem'
    node.innerHTML = `<span class="el-cascader-node__label">${name}</span>`
    if (depth < 2) {
      node.setAttribute('aria-haspopup', 'true'); const icon = document.createElement('i'); icon.className = 'el-cascader-node__postfix'; node.append(icon)
      node.addEventListener('mouseenter', () => { clicked.push(name); setTimeout(() => { if (!root.isConnected) return; if (popup.querySelectorAll('ul').length > depth + 1) return; const menu = document.createElement('ul'); menu.className = 'el-cascader-menu__list'; menu.append(level(depth === 0 ? '嘉兴市' : '海宁市', depth + 1)); popup.append(menu) }, delay) })
    } else { const radio = document.createElement('input'); radio.type = 'radio'; radio.onclick = () => { clicked.push(name); input.value = '浙江省 / 嘉兴市 / 海宁市'; popup.hidden = true }; node.prepend(radio) }
    return node
  }
  popup.querySelector('ul')!.append(level('浙江省', 0))
  return { popup, root, input, clicked }
}
describe('selection widget adapters', () => {
  it('selects a semantic button combobox through its associated listbox', async () => {
    document.body.innerHTML = '<form><label for="semantic">类别</label><button id="semantic" type="button" role="combobox" aria-controls="semantic-list" data-placeholder>请选择</button></form><div id="semantic-list" role="listbox" hidden><div role="option">工程类</div></div>'
    const combo = document.getElementById('semantic')!, list = document.getElementById('semantic-list')!
    combo.onclick = () => { list.hidden = !list.hidden }
    list.firstElementChild!.addEventListener('click', () => { combo.removeAttribute('data-placeholder'); combo.textContent = '工程类'; list.hidden = true })
    const form = live(); expect(form.describe().fields[0].label).toBe('类别')
    expect((await form.apply([{ fieldId: 'f1', value: '工程类' }])).fields[0]).toMatchObject({ status: 'filled', value: '工程类' })
  })
  it('does not click a combobox incorrectly implemented as a submit button', async () => {
    document.body.innerHTML = '<form><button role="combobox" aria-controls="unsafe-list" data-placeholder>请选择</button></form><div id="unsafe-list" role="listbox" hidden><div role="option">是</div></div>'
    const clicked = vi.fn(); document.querySelector('button')!.addEventListener('click', clicked)
    expect((await live().apply([{ fieldId: 'f1', value: '是' }])).fields[0].reason).toContain('提交按钮')
    expect(clicked).not.toHaveBeenCalled()
  })
  it('does not report discarded native multiselect choices as successful', async () => {
    document.body.innerHTML = '<form><label>类别<select multiple><option value="a">甲</option><option value="b">乙</option></select></label></form>'
    const select = document.querySelector('select')!; select.onchange = () => { select.options[1]!.selected = false }
    expect((await live().apply([{ fieldId: 'f1', value: '["a","b"]' }])).fields[0].status).toBe('failed')
  })
  it('identifies a readonly Element Plus combobox once and reads its own real options', async () => {
    const { list } = select(); const form = live()
    expect(form.describe().fields).toHaveLength(1)
    expect(form.describe().fields[0]).toMatchObject({ label: '预留中小企业采购份额', type: 'custom-select', optionsState: 'needs-open', value: '' })
    const choices = await form.options('f1')
    expect(choices.options.map(option => option.label)).toEqual(['是', '否']); expect(list.hidden).toBe(true)
    expect(form.describe().fields[0].value).toBe('')
    const result = await form.apply([{ fieldId: 'f1', value: '是' }])
    expect(result.fields[0]).toMatchObject({ status: 'filled', value: '是' }); expect(form.describe().fields[0].value).toBe('是')
  })
  it('rejects ambiguous, disabled and missing custom options without selecting a fallback', async () => {
    const { list } = select(['是', '是', '否']); list.lastElementChild!.setAttribute('aria-disabled', 'true')
    const form = live()
    expect((await form.apply([{ fieldId: 'f1', value: '是' }], false, { timeoutMs: 100 })).fields[0].reason).toContain('重名')
    expect((await form.apply([{ fieldId: 'f1', value: '否' }], false, { timeoutMs: 100 })).fields[0].reason).toContain('不可选')
    expect((await form.apply([{ fieldId: 'f1', value: '未知' }], false, { timeoutMs: 100 })).fields[0].status).toBe('failed')
    expect(form.describe().fields[0].value).toBe('')
  })
  it('selects an asynchronous province/city/district path and verifies the final component display', async () => {
    const { input, clicked } = cascader()
    const form = live(); expect(form.describe().fields).toHaveLength(1); expect(form.describe().fields[0].type).toBe('cascader')
    const value = JSON.stringify(['浙江省', '嘉兴市', '海宁市'])
    expect((await form.apply([{ fieldId: 'f1', value }])).fields[0]).toMatchObject({ status: 'filled', value })
    expect(clicked).toEqual(['浙江省', '嘉兴市', '海宁市']); expect(input.value).toBe('浙江省 / 嘉兴市 / 海宁市')
  })
  it('stops pending cascade selection after cancellation, without clicking a later level', async () => {
    const { clicked } = cascader(500), form = live(), controller = new AbortController()
    const pending = form.apply([{ fieldId: 'f1', value: '["浙江省","嘉兴市","海宁市"]' }], false, { signal: controller.signal })
    const assertion = expect(pending).rejects.toThrow(); setTimeout(() => controller.abort(), 40); await assertion
    expect(clicked).toEqual(['浙江省'])
  })
  it('recognizes month/date combo inputs and commits localized month values through events', async () => {
    document.body.innerHTML = '<form><div class="el-form-item"><label>预计采购时间</label><div class="el-date-editor el-date-editor--month"><input role="combobox" placeholder="选择年份与月份"></div></div></form>'
    const input = document.querySelector('input')!, committed: string[] = []
    input.addEventListener('change', () => { committed.push(input.value) })
    const form = live(); expect(form.describe().fields[0].type).toBe('month')
    expect((await form.apply([{ fieldId: 'f1', value: '2026-11' }])).fields[0]).toMatchObject({ status: 'filled', value: '2026-11' })
    expect(committed).toEqual(['2026年11月']); expect(input.value).toBe('2026年11月')
  })
  it('reads a radio group and checks the real input, not a text substitute', async () => {
    document.body.innerHTML = '<form><div class="el-form-item"><label>是否预留</label><div class="el-radio-group"><label>是<input type="radio" name="share" value="yes"></label><label>否<input type="radio" name="share" value="no"></label></div></div></form>'
    const form = live(); expect(form.describe().fields).toHaveLength(1)
    expect((await form.options('f1')).options.map(option => option.value)).toEqual(['yes', 'no'])
    expect((await form.apply([{ fieldId: 'f1', value: 'yes' }])).fields[0].status).toBe('filled')
    expect(document.querySelector<HTMLInputElement>('input[value="yes"]')!.checked).toBe(true)
  })
  it('waits for dependent native select options after the parent change', async () => {
    document.body.innerHTML = '<form><label>省<select id="province"><option value="">请选择</option><option value="zj">浙江省</option></select></label><label>市<select disabled id="city"><option value="">请选择</option></select></label></form>'
    const city = document.querySelector<HTMLSelectElement>('#city')!
    document.getElementById('province')!.addEventListener('change', () => setTimeout(() => { city.disabled = false; city.append(new Option('嘉兴市', 'jx')) }, 40))
    const form = live(); expect(form.describe().fields).toHaveLength(2)
    const result = await form.apply([{ fieldId: 'f1', value: 'zj' }, { fieldId: 'f2', value: 'jx' }])
    expect(result.fields.map(field => field.status)).toEqual(['filled', 'filled']); expect(city.value).toBe('jx')
  })
})
