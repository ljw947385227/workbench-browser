import type { Assignment, Descriptor, FieldResult, FillResult } from '../shared.ts'
import { collect, describeControl, empty, nativeOptions, read, type Control, type Native } from './controls.ts'
import { arrayValue, checkpoint, disabled, label, setNative, until, visible, type Interaction } from './control-utils.ts'
import { fillWidget, widgetOptions } from './widgets.ts'
export { visible } from './visibility.ts'
export interface Target { frame?: HTMLIFrameElement; root?: HTMLElement; title: string }
export function targetDocument(target: Target): Document {
  const document = target.frame ? target.frame.contentDocument : target.root?.ownerDocument
  if (!document || !document.defaultView) throw new Error('网页不可访问；需要同源 iframe 或专门的接入桥')
  return document
}
export function discover(target: Target): HTMLElement[] {
  const document = targetDocument(target), scope = target.root || document.body
  const dialogs = [...scope.querySelectorAll<HTMLElement>('[role="dialog"],dialog[open],.el-dialog')].filter(visible), area = dialogs.at(-1) || scope
  const forms = [...area.querySelectorAll<HTMLElement>('form,[role="form"],.el-form')].filter(element => visible(element) && collect(element).length).filter((element, _index, all) => !all.some(other => other !== element && other.contains(element)))
  if (area.matches('form,[role="form"],.el-form') && collect(area).length) return [area]
  return forms.length ? forms : collect(area).length ? [area] : []
}
export function formTitle(root: HTMLElement, index: number): string { return root.getAttribute('aria-label') || root.querySelector('legend,h1,h2,h3')?.textContent?.trim() || `当前表单 ${index + 1}` }
export class LiveForm {
  readonly elements: HTMLElement[]
  private controls: Control[]
  private document: Document
  private page: string
  constructor(readonly target: Target, readonly root: HTMLElement) {
    this.document = targetDocument(target); this.page = this.document.location.href
    this.controls = collect(root); this.elements = this.controls.map(control => control.element)
    if (!this.controls.length || this.controls.length > 100) throw new Error('未找到支持的字段，或字段超过 100 项，请选择更具体的表单')
  }
  assertCurrent() {
    if (targetDocument(this.target) !== this.document || this.document.location.href !== this.page || !visible(this.root) || this.target.frame && (!this.target.frame.isConnected || !visible(this.target.frame))) throw new Error('网页已切换，请重新关联表单')
    const current = collect(this.root)
    if (current.length !== this.controls.length || current.some((control, index) => control.element !== this.controls[index]!.element || control.kind !== this.controls[index]!.kind || control.members?.length !== this.controls[index]!.members?.length || control.members?.some((member, i) => member !== this.controls[index]!.members![i]))) throw new Error('表单字段已变化，请重新关联')
  }
  describe(): Descriptor { this.assertCurrent(); return { title: this.target.title, page: this.document.location.pathname + this.document.location.hash, fields: this.controls.map((control, index) => describeControl(control, `f${index + 1}`)) } }
  private control(fieldId: string) { const control = /^f[1-9]\d*$/u.test(fieldId) ? this.controls[Number(fieldId.slice(1)) - 1] : undefined; if (!control) throw new Error('字段 ID 不存在，请重新读取表单'); return control }
  async options(fieldId: string, context: Interaction = {}) {
    const ctx = { ...context, assert: () => { context.assert?.(); this.assertCurrent() } }; checkpoint(ctx)
    const control = this.control(fieldId), options = nativeOptions(control)
    await until(() => !disabled(control.element), ctx, '此字段的前置选择尚未完成或当前不可编辑')
    if (options) return { fieldId, type: control.type, multiple: control.multiple, options: await until(() => { const loaded = nativeOptions(control)!; return loaded.length ? loaded : undefined }, ctx, '当前字段尚未加载出选项') }
    if (control.kind !== 'select' && control.kind !== 'cascader') throw new Error('此字段没有可读取的选择列表')
    return { fieldId, ...await widgetOptions(control, ctx) }
  }
  async apply(assignments: Assignment[], overwrite = false, context: Interaction = {}): Promise<FillResult> {
    const ctx = { ...context, assert: () => { context.assert?.(); this.assertCurrent() } }; checkpoint(ctx)
    const fields: FieldResult[] = []
    for (const assignment of assignments) {
      checkpoint(ctx)
      const control = this.control(assignment.fieldId), previous = read(control)
      const result: FieldResult = { ...assignment, label: label(control.element), previous, status: 'failed' }
      if (previous === assignment.value) { fields.push({ ...result, status: 'unchanged' }); continue }
      if (!empty(control, previous) && !overwrite) { fields.push({ ...result, status: 'conflict' }); continue }
      try {
        await until(() => !disabled(control.element), ctx, '字段当前不可编辑或联动选项未就绪')
        if (read(control) !== previous) { fields.push({ ...result, status: 'conflict', reason: '等待期间字段已变化，已跳过' }); continue }
        if (control.kind !== 'native' && control.kind !== 'radio') await fillWidget(control, assignment.value, ctx)
        else if (control.kind === 'radio') {
          const matches = control.members!.filter(member => member.value === assignment.value || label(member) === assignment.value)
          if (matches.length !== 1 || disabled(matches[0]!)) throw new Error('单选项不存在、重名或不可用')
          checkpoint(ctx); matches[0]!.click(); await until(() => matches[0]!.checked, ctx, '页面未确认单选结果')
        } else {
          const element = control.element as Native
          if (control.type === 'checkbox' && !['true', 'false'].includes(assignment.value)) throw new Error('复选框仅接受 true / false')
          const values = control.multiple ? arrayValue(assignment.value) : [assignment.value]
          if (element.tagName === 'SELECT') await until(() => values.every(value => [...(element as HTMLSelectElement).options].some(option => option.value === value && !option.disabled)), ctx, '当前选择项不存在或联动选项尚未加载')
          checkpoint(ctx)
          if (read(control) !== previous) { fields.push({ ...result, status: 'conflict', reason: '等待期间字段已变化，已跳过' }); continue }
          if (control.multiple) for (const option of (element as HTMLSelectElement).options) option.selected = values.includes(option.value)
          else setNative(element, assignment.value, control.type === 'checkbox' ? 'checked' : 'value')
          if (!element.checkValidity() || !control.multiple && read(control) !== assignment.value) { setNative(element, previous, control.type === 'checkbox' ? 'checked' : 'value'); throw new Error('格式、范围或页面校验不通过') }
          const view = this.document.defaultView!
          element.dispatchEvent(new view.Event('input', { bubbles: true })); element.dispatchEvent(new view.Event('change', { bubbles: true }))
          if (!control.multiple && read(control) !== assignment.value) throw new Error('页面没有保留该值，请人工检查')
          if (control.multiple) { const actual = JSON.parse(read(control)) as string[]; if (actual.length !== values.length || actual.some(value => !values.includes(value))) throw new Error('页面没有保留全部多选项，请人工检查') }
        }
        checkpoint(ctx); fields.push({ ...result, status: 'filled', value: read(control) })
      } catch (error) { checkpoint(ctx); fields.push({ ...result, reason: (error as Error).message }) }
    }
    return { fields, missing: this.describe().fields.filter(field => field.required && (!field.value || field.value === '[]' || field.type === 'checkbox' && field.value === 'false')).map(field => field.label) }
  }
}
