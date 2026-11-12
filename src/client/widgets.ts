import { read, normalizeDate, type Control } from './controls.ts'
import { arrayValue, checkpoint, disabled, setNative, text, until, visible, type Interaction } from './control-utils.ts'
const POPUPS = '[role="listbox"],[role="tree"],.el-select-dropdown,.el-cascader__dropdown,.ant-select-dropdown,.ant-cascader-dropdown'
function compatible(panel: HTMLElement, control: Control) {
  return control.kind === 'cascader' ? panel.matches('.el-cascader__dropdown,.ant-cascader-dropdown,[role="tree"]') || !!panel.querySelector('.el-cascader-menu,.ant-cascader-menu,[role="tree"]')
    : panel.matches('[role="listbox"],.el-select-dropdown,.ant-select-dropdown') || !!panel.querySelector('[role="option"]')
}
function linked(control: Control): HTMLElement | undefined {
  for (const source of [control.element, ...control.element.querySelectorAll<HTMLElement>('[aria-controls],[aria-owns],[aria-describedby]')]) {
    for (const key of ['aria-controls', 'aria-owns', 'aria-describedby']) for (const id of (source.getAttribute(key) || '').split(/\s+/u).filter(Boolean)) {
      const panel = source.ownerDocument.getElementById(id)
      if (panel && compatible(panel, control) && visible(panel)) return panel
    }
  }
}
function candidates(control: Control) { return [...control.element.ownerDocument.querySelectorAll<HTMLElement>(POPUPS)].filter(panel => visible(panel) && compatible(panel, control)).filter((panel, _i, all) => !all.some(other => other !== panel && other.contains(panel))) }
function clickable(control: Control) { return control.element.querySelector<HTMLElement>('.el-select__wrapper,.ant-select-selector') || control.element }
function click(element: HTMLElement, ctx: Interaction) {
  if (element.tagName === 'BUTTON' && (element as HTMLButtonElement).form && (element as HTMLButtonElement).type === 'submit') throw new Error('此控件使用了提交按钮，暂不自动点击')
  checkpoint(ctx); element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  const view = element.ownerDocument.defaultView!
  element.dispatchEvent(new view.MouseEvent('mousedown', { bubbles: true, button: 0 }))
  element.dispatchEvent(new view.MouseEvent('mouseup', { bubbles: true, button: 0 }))
  checkpoint(ctx); element.click()
}
async function open(control: Control, ctx: Interaction) {
  if (disabled(control.element)) throw new Error('选择控件当前不可编辑')
  const existing = linked(control)
  if (existing) return { panel: existing, opened: false }
  const before = new Set(candidates(control)); click(clickable(control), ctx)
  const panel = await until(() => { const own = linked(control); if (own) return own; const fresh = candidates(control).filter(panel => !before.has(panel)); return fresh.length === 1 ? fresh[0] : undefined }, ctx, '未能唯一定位此字段的选项弹层；请手动展开或补充控件适配')
  return { panel, opened: true }
}
function close(control: Control, panel: HTMLElement, ctx: Interaction) { if (visible(panel)) click(clickable(control), ctx) }
function nodes(panel: HTMLElement) { return [...panel.querySelectorAll<HTMLElement>('[role="option"],.el-select-dropdown__item,.ant-select-item-option')].filter(visible) }
function optionLabel(element: HTMLElement) { return text(element.querySelector('.el-cascader-node__label,.ant-cascader-menu-item-content,.ant-select-item-option-content') || element) }
function optionValue(element: HTMLElement) { return element.getAttribute('data-value') || element.getAttribute('data-key') || optionLabel(element) }
function exact(options: HTMLElement[], value: string): HTMLElement {
  const matches = options.filter(option => optionValue(option) === value || optionLabel(option) === value)
  if (matches.length !== 1) throw new Error(matches.length ? `选项「${value}」重名，需人工选择` : `没有找到真实选项「${value}」，请先读取选项`)
  if (disabled(matches[0]!)) throw new Error(`选项「${value}」不可选`)
  return matches[0]!
}
function columns(panel: HTMLElement): HTMLElement[][] {
  const menus = [...panel.querySelectorAll<HTMLElement>('.el-cascader-menu__list,.ant-cascader-menu,[role="group"]')].filter(visible)
  if (!menus.length && panel.matches('[role="tree"]')) return [[...panel.querySelectorAll<HTMLElement>('[role="treeitem"]')].filter(visible)]
  return menus.map(menu => [...menu.children].filter((node): node is HTMLElement => node instanceof menu.ownerDocument.defaultView!.HTMLElement && node.matches('.el-cascader-node,.ant-cascader-menu-item,[role="treeitem"],[role="menuitem"]') && visible(node)))
}
function detectMultiple(control: Control, panel: HTMLElement) { const listbox = panel.matches('[role="listbox"]') ? panel : panel.querySelector('[role="listbox"]'); if (control.kind === 'select' && listbox?.getAttribute('aria-multiselectable') === 'true') { control.multiple = true; control.type = 'custom-multiselect' } }
export async function widgetOptions(control: Control, ctx: Interaction) {
  const { panel, opened } = await open(control, ctx)
  try {
    detectMultiple(control, panel)
    const options = await until(() => { const values = control.kind === 'cascader' ? columns(panel)[0] || [] : nodes(panel); return values.length ? values : undefined }, ctx, '该选择控件没有加载出可读取的选项')
    return { type: control.type, multiple: control.multiple, level: control.kind === 'cascader' ? 0 : undefined,
      options: options.slice(0, 200).map(node => ({ label: optionLabel(node), value: optionValue(node), disabled: disabled(node), ...(control.kind === 'cascader' ? { expandable: node.getAttribute('aria-haspopup') === 'true' || !!node.querySelector('.el-cascader-node__postfix') } : {}) })) }
  } finally { if (opened) { checkpoint(ctx); close(control, panel, ctx) } }
}
async function choose(control: Control, value: string, ctx: Interaction) {
  let { panel } = await open(control, ctx); detectMultiple(control, panel)
  const desired = control.multiple ? arrayValue(value) : [value]
  const old = control.multiple ? JSON.parse(read(control) || '[]') as string[] : []
  if (control.multiple && old.some(item => !desired.includes(item))) throw new Error('多选已有项的移除暂需手动操作；本次未更改')
  for (const wanted of desired) {
    checkpoint(ctx)
    if (control.multiple && (JSON.parse(read(control) || '[]') as string[]).includes(wanted)) continue
    if (!visible(panel)) panel = (await open(control, ctx)).panel
    const options = await until(() => { const all = nodes(panel); return all.length ? all : undefined }, ctx, '选项未加载完成')
    const selected = exact(options, wanted), expected = optionLabel(selected)
    click(selected, ctx)
    await until(() => control.multiple ? (JSON.parse(read(control) || '[]') as string[]).includes(expected) : read(control) === expected || read(control) === wanted, ctx, `页面未确认选中「${wanted}」`)
  }
  if (control.multiple && visible(panel)) close(control, panel, ctx)
}
async function cascade(control: Control, value: string, ctx: Interaction) {
  const path = arrayValue(value), { panel } = await open(control, ctx)
  for (let index = 0; index < path.length; index++) {
    const current = await until(() => { const level = columns(panel)[index]; return level?.length ? level : undefined }, ctx, `第 ${index + 1} 级地区选项未加载；已执行的联动需在页面核对`)
    const node = exact(current, path[index]!)
    if (index < path.length - 1) {
      const before = columns(panel)[index + 1] || []
      const beforeLabels = before.map(optionLabel)
      const alreadyExpanded = node.getAttribute('aria-expanded') === 'true' || node.classList.contains('in-active-path') || node.classList.contains('ant-cascader-menu-item-expand')
      const expanded = () => {
        const after = columns(panel)[index + 1] || []
        return after.length > 0 && (alreadyExpanded || after.length !== before.length || after.some((element, i) => element !== before[i] || optionLabel(element) !== beforeLabels[i]))
      }
      const view = node.ownerDocument.defaultView!; checkpoint(ctx)
      node.dispatchEvent(new view.MouseEvent('mouseover', { bubbles: true })); node.dispatchEvent(new view.MouseEvent('mouseenter', { bubbles: false }))
      try { await until(() => expanded() ? true : undefined, { ...ctx, timeoutMs: Math.min(ctx.timeoutMs ?? 4500, 700) }, '等待展开') }
      catch { checkpoint(ctx); click(node.querySelector<HTMLElement>('.el-cascader-node__postfix,.ant-cascader-menu-item-expand-icon') || node, ctx) }
      await until(() => expanded() ? true : undefined, ctx, `「${path[index]}」的下级地区未加载，后续步骤未执行`)
    } else click(node.querySelector<HTMLElement>('.el-radio,input[type="radio"],input[type="checkbox"],[role="radio"]') || node, ctx)
  }
  await until(() => { const actual = read(control); if (!actual) return; try { const selected = JSON.parse(actual) as string[]; return selected.length === path.length && selected.every((part, i) => part === path[i]) } catch { return } }, ctx, '地区控件未回显完整路径；不能确认选择成功，请核对页面')
  if (visible(panel)) close(control, panel, ctx)
}
async function date(control: Control, value: string, ctx: Interaction) {
  const input = control.element.querySelector<HTMLInputElement>('input')
  if (!input || input.readOnly || input.disabled || !['date', 'month'].includes(control.type)) throw new Error('此日期控件暂不能直接编辑；日期范围或只读日历需专门适配')
  const pattern = control.type === 'month' ? /^\d{4}-(0[1-9]|1[0-2])$/u : /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u
  if (!pattern.test(value) || control.type === 'date' && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw new Error('日期格式不正确，日期用 YYYY-MM-DD，年月用 YYYY-MM')
  const display = control.type === 'month' && /年|月/u.test(input.placeholder + input.value) ? value.replace(/^(\d{4})-(\d{2})$/u, '$1年$2月') : value
  checkpoint(ctx); input.focus(); setNative(input, display)
  const view = input.ownerDocument.defaultView!
  input.dispatchEvent(new view.Event('input', { bubbles: true })); input.dispatchEvent(new view.Event('change', { bubbles: true }))
  input.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
  input.blur(); input.dispatchEvent(new view.FocusEvent('blur', { bubbles: false }))
  await new Promise<void>(resolve => setTimeout(resolve, 100))
  await until(() => normalizeDate(input.value, control.type) === value && input.getAttribute('aria-invalid') !== 'true', ctx, '日期控件没有接受该值，请检查页面格式')
}
export async function fillWidget(control: Control, value: string, ctx: Interaction) {
  if (control.kind === 'select') await choose(control, value, ctx)
  else if (control.kind === 'cascader') await cascade(control, value, ctx)
  else if (control.kind === 'date-picker') await date(control, value, ctx)
}
