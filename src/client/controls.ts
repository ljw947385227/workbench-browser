import type { Descriptor } from '../shared.ts'
import { disabled, label, text, visible } from './control-utils.ts'
export type Native = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
export interface Control { element: HTMLElement; kind: 'native' | 'select' | 'cascader' | 'date-picker' | 'radio'; type: string; members?: HTMLInputElement[]; multiple: boolean }
const WIDGET = '.el-cascader,.el-select,.el-date-editor,.ant-select,.ant-cascader,[role="combobox"]'
function widget(element: HTMLElement): Control | undefined {
  if (element.matches('.el-cascader,.ant-cascader') || element.matches('[role="combobox"][aria-haspopup="tree"]')) return { element, kind: 'cascader', type: 'cascader', multiple: false }
  if (element.matches('.el-date-editor')) {
    const type = element.classList.contains('el-date-editor--month') ? 'month' : element.classList.contains('el-date-editor--date') ? 'date' : 'unsupported-date-range'
    return { element, kind: 'date-picker', type, multiple: false }
  }
  if (element.matches('.el-select,.ant-select') || element.matches('[role="combobox"]') && !element.closest('.el-autocomplete,.el-date-editor,.el-cascader')) {
    if (element.matches('select')) return
    const multiple = element.matches('.is-multiple,.ant-select-multiple') || !!element.querySelector('.el-tag,.ant-select-selection-overflow')
    return { element, kind: 'select', type: multiple ? 'custom-multiselect' : 'custom-select', multiple }
  }
}
export function collect(root: HTMLElement): Control[] {
  const result: Control[] = []
  const radios = new Map<string | HTMLElement, Control>()
  for (const element of root.querySelectorAll<HTMLElement>(`input,textarea,select,${WIDGET}`)) {
    const parentWidget = element.parentElement?.closest(WIDGET) as HTMLElement | null
    if (parentWidget && root.contains(parentWidget) && widget(parentWidget)) continue
    const custom = widget(element)
    if (custom) { if (visible(element)) result.push(custom); continue }
    if (!element.matches('input,textarea,select')) continue
    const native = element as Native
    if (['password', 'hidden', 'file', 'submit', 'reset', 'button'].includes(native.type) || native.autocomplete?.includes('password') || 'readOnly' in native && native.readOnly) continue
    if (native.type === 'radio') {
      const radio = native as HTMLInputElement
      const group = radio.closest<HTMLElement>('[role="radiogroup"],.el-radio-group,.ant-radio-group')
      if (!visible(group || radio)) continue
      const key = group || radio.name || radio
      const existing = radios.get(key)
      if (existing) existing.members!.push(radio)
      else { const control: Control = { element: group || radio, kind: 'radio', type: 'radio-group', multiple: false, members: [radio] }; radios.set(key, control); result.push(control) }
      continue
    }
    if (!visible(native)) continue
    result.push({ element: native, kind: 'native', type: native.tagName === 'SELECT' && (native as HTMLSelectElement).multiple ? 'select-multiple' : native.type, multiple: native.tagName === 'SELECT' && (native as HTMLSelectElement).multiple })
  }
  return result
}
export function trigger(control: Control): HTMLElement { return control.element.querySelector<HTMLElement>('[role="combobox"],input,button') || control.element }
export function normalizeDate(value: string, type: string): string {
  const match = value.trim().match(/^(\d{4})[年/.-](\d{1,2})(?:[月/.-](\d{1,2})日?)?月?$/u)
  return match ? `${match[1]}-${match[2].padStart(2, '0')}${type === 'month' ? '' : match[3] ? '-' + match[3].padStart(2, '0') : ''}` : value.trim()
}
export function read(control: Control): string {
  const element = control.element
  if (control.kind === 'radio') return control.members!.find(member => member.checked)?.value || ''
  if (control.kind === 'native') {
    if (element.tagName === 'SELECT' && control.multiple) return JSON.stringify([...(element as HTMLSelectElement).selectedOptions].map(option => option.value))
    return control.type === 'checkbox' ? String((element as HTMLInputElement).checked) : (element as Native).value
  }
  const input = element.matches('input') ? element as HTMLInputElement : element.querySelector<HTMLInputElement>('input')
  if (control.kind === 'cascader') return input?.value.trim() ? JSON.stringify(input.value.split(/\s*[/＞>]\s*/u)) : ''
  if (control.kind === 'date-picker') return normalizeDate(input?.value || '', control.type)
  if (control.multiple) return JSON.stringify([...element.querySelectorAll('.el-tag__content,.ant-select-selection-item')].map(text).filter(Boolean))
  const chosen = element.querySelector('.el-select__placeholder:not(.is-transparent),.ant-select-selection-item,[data-selected-label]')
  if (chosen) return text(chosen)
  if (element.querySelector('.is-transparent,.ant-select-selection-placeholder')) return ''
  if (element.matches('[role="combobox"]:not(input)')) return element.hasAttribute('data-placeholder') ? '' : element.getAttribute('aria-valuetext') || text(element)
  return input?.value || element.getAttribute('data-value') || ''
}
export function empty(control: Control, value: string) { return !value || control.multiple && value === '[]' || control.type === 'checkbox' && value === 'false' }
export function nativeOptions(control: Control) {
  if (control.kind === 'radio') return control.members!.map(member => ({ value: member.value, label: label(member), disabled: disabled(member) }))
  if (control.element.tagName === 'SELECT') return [...(control.element as HTMLSelectElement).options].filter(option => !!option.value).map(option => ({ value: option.value, label: option.textContent || option.value, disabled: option.disabled }))
  return undefined
}
export function describeControl(control: Control, fieldId: string): Descriptor['fields'][number] {
  const element = control.element
  const input = element.matches('input,textarea,select') ? element as Native : element.querySelector<Native>('input,select,textarea')
  const options = nativeOptions(control)
  return { fieldId, label: label(element), type: control.type, required: !!input?.required || element.getAttribute('aria-required') === 'true' || !!element.closest('.el-form-item.is-required,.ant-form-item-required'), value: read(control).slice(0, 8000),
    disabled: disabled(element), multiple: control.multiple,
    ...(options ? { options: options.slice(0, 200), optionsState: 'ready' as const } : control.kind === 'select' || control.kind === 'cascader' ? { optionsState: 'needs-open' as const } : {}),
    ...(control.kind === 'cascader' ? { hint: '级联必须填写完整的已知标签路径，value 为 JSON 数组字符串，如 ["浙江省","嘉兴市","海宁市"]；先 options 查看首层。中间级可能触发联动，不凭空猜测未提供的地区。' } : control.multiple ? { hint: 'value 为 JSON 字符串数组；先读取真实选项。' } : control.kind === 'date-picker' ? { hint: control.type === 'month' ? 'value 格式 YYYY-MM，客户端转换为页面年月格式并提交控件事件。' : 'value 格式 YYYY-MM-DD。日期范围暂不支持。' } : {}),
  }
}
