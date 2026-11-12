export { visible } from './visibility.ts'
export interface Interaction { signal?: AbortSignal; assert?(): void; timeoutMs?: number }
export function checkpoint(ctx: Interaction) { ctx.signal?.throwIfAborted(); ctx.assert?.() }
export async function until<T>(read: () => T | undefined | false, ctx: Interaction, message: string): Promise<T> {
  const deadline = Date.now() + (ctx.timeoutMs ?? 4500)
  while (true) {
    checkpoint(ctx)
    const value = read()
    if (value !== undefined && value !== false) return value as T
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); ctx.signal?.removeEventListener('abort', abort); reject(ctx.signal?.reason || new Error('已取消')) }
      const timer = setTimeout(() => { ctx.signal?.removeEventListener('abort', abort); resolve() }, 60)
      ctx.signal?.addEventListener('abort', abort, { once: true })
    })
  }
}
export function text(element: Element | null | undefined) { return (element?.getAttribute('aria-label') || element?.textContent || '').replace(/\s+/gu, ' ').trim() }
export function disabled(element: HTMLElement) { return element.getAttribute('aria-disabled') === 'true' || element.matches(':disabled,.is-disabled,.disabled,.ant-select-disabled') || !!element.closest('[aria-disabled="true"],.is-disabled,.ant-select-disabled') }
function labelText(element: Element) {
  const clone = element.cloneNode(true) as Element
  for (const child of clone.querySelectorAll('input,textarea,select,button,[role="listbox"],script,style')) child.remove()
  return text(clone)
}
export function label(element: HTMLElement): string {
  const labels = 'labels' in element ? [...((element as HTMLInputElement).labels || [])].map(labelText).join(' ') : ''
  const labelled = (element.getAttribute('aria-labelledby') || '').split(/\s+/u).filter(Boolean).map(id => text(element.ownerDocument.getElementById(id))).join(' ')
  const group = element.closest('.el-form-item,.form-item,.ant-form-item')?.querySelector('label')
  const associated = [element, ...element.querySelectorAll<HTMLElement>('[id]')].flatMap(node => node.id ? [...element.ownerDocument.querySelectorAll('label')].filter(item => item.htmlFor === node.id) : []).map(labelText).join(' ')
  return (labels || element.getAttribute('aria-label') || labelled || (group ? labelText(group) : '') || associated || element.getAttribute('placeholder') || element.getAttribute('name') || '未命名字段').replace(/^[\s*]+|[\s*:：]+$/gu, '').slice(0, 300)
}
export function setNative(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string, property = 'value') {
  const view = element.ownerDocument.defaultView! as unknown as Record<string, { prototype: object }>
  const kind = element.tagName === 'INPUT' ? 'HTMLInputElement' : element.tagName === 'SELECT' ? 'HTMLSelectElement' : 'HTMLTextAreaElement'
  Object.getOwnPropertyDescriptor(view[kind]!.prototype, property)!.set!.call(element, property === 'checked' ? value === 'true' : value)
}
export function arrayValue(raw: string): string[] {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('多选或级联值须为 JSON 字符串数组，例如 ["浙江省","嘉兴市","海宁市"]') }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 30 || parsed.some(item => typeof item !== 'string' || !item.trim())) throw new Error('请选择明确且非空的选项路径/列表')
  return parsed as string[]
}
