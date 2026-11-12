import { randomBytes } from 'node:crypto'
import { descriptorSchema, type BrowserTask, type Descriptor, type Assignment, type PageCommand } from './shared.ts'
interface Pending { task: BrowserTask; issued: boolean; resolve(value: unknown): void; reject(error: Error): void; cleanup(): void }
interface Binding { sessionId: string; secret: string; descriptor: Descriptor; automatic: boolean; paused?: boolean; clientVersion?: string; touched: number; pending?: Pending }
/** Ephemeral, conversation-scoped browser task transport. Never replays dispatched writes. */
export class FormBroker {
  private bindings = new Map<string, Binding>()
  constructor(private timeoutMs = 90000) {}
  bind(sessionId: string, descriptor: Descriptor, automatic = false, clientVersion?: string) {
    this.sweep()
    if (this.bindings.size >= 64) throw new Error('活动表单过多，请关闭旧的填写任务')
    const formRef = randomBytes(24).toString('hex'), secret = randomBytes(32).toString('hex')
    this.bindings.set(formRef, { sessionId, descriptor, secret, automatic, clientVersion, touched: Date.now() })
    return { formRef, secret }
  }
  targets(sessionId: string) {
    this.sweep()
    return [...this.bindings].filter(([, binding]) => binding.sessionId === sessionId && binding.automatic && Date.now() - binding.touched < 5000)
      .map(([formRef, binding]) => ({ formRef, title: binding.descriptor.title, page: binding.descriptor.page, ...(binding.paused ? { paused: true } : {}), ...(binding.clientVersion ? { clientVersion: binding.clientVersion } : {}) }))
  }
  resolve(sessionId: string, ref?: string) {
    if (ref) { if (this.get(ref).sessionId !== sessionId) throw new Error('该表单属于另一个对话'); return ref }
    const targets = this.targets(sessionId)
    if (!targets.length) throw new Error('当前聊天右侧没有可操作的网页。请打开目标工作台，稍后调用 targets；不需要手动关联。')
    if (targets.length !== 1) throw new Error('当前聊天右侧有多个网页，请先调用 targets 并根据用户目标选择明确的 formRef')
    return targets[0]!.formRef
  }
  private get(ref: string) {
    this.sweep()
    const binding = this.bindings.get(ref)
    if (!binding) throw new Error('表单引用已失效，请重新点击辅助填写')
    return binding
  }
  private browser(ref: string, secret: string) {
    const binding = this.get(ref)
    if (binding.secret !== secret) throw new Error('无权访问该网页任务')
    binding.touched = Date.now()
    return binding
  }
  poll(ref: string, secret: string): BrowserTask | null {
    const binding = this.browser(ref, secret)
    const pending = binding.pending
    if (!pending || pending.issued) return null
    pending.issued = true
    return pending.task
  }
  result(ref: string, secret: string, taskId: string, result: unknown) {
    const binding = this.browser(ref, secret)
    const pending = binding.pending
    if (!pending || pending.task.id !== taskId || !pending.issued) throw new Error('填写任务已结束，请重新检查表单')
    const descriptor = descriptorSchema.safeParse(result)
    if (descriptor.success) binding.descriptor = descriptor.data
    else if (pending.task.action === 'page' && result && typeof result === 'object') {
      const metadata = descriptorSchema.pick({ title: true, page: true }).safeParse(result)
      if (metadata.success) { binding.descriptor.title = metadata.data.title; binding.descriptor.page = metadata.data.page }
    }
    pending.resolve(result)
  }
  close(ref: string, secret: string) { this.browser(ref, secret); this.remove(ref, '网页连接已关闭') }
  pause(ref: string, secret: string, paused: boolean) { this.browser(ref, secret).paused = paused }
  invoke(ref: string, sessionId: string, action: BrowserTask['action'], assignments: Assignment[], signal: AbortSignal, fieldId?: string, command?: PageCommand): Promise<unknown> {
    signal.throwIfAborted()
    const binding = this.get(ref)
    if (binding.sessionId !== sessionId) throw new Error('该表单属于另一个对话')
    if (binding.paused) throw new Error('用户已接管网页，Agent 已暂停。请等待用户点击允许 Agent 继续，不要自行重试。')
    if (binding.pending) throw new Error('该表单正在处理其他任务，请稍后重试')
    const ids = new Set(binding.descriptor.fields.map(field => field.fieldId))
    if (action === 'options' && (!fieldId || !ids.has(fieldId))) throw new Error('读取选项需要有效的字段 ID')
    if (assignments.some(item => !ids.has(item.fieldId)) || new Set(assignments.map(item => item.fieldId)).size !== assignments.length) throw new Error('字段 ID 无效或重复，请先检查当前表单')
    return new Promise((resolve, reject) => {
      const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); binding.pending = undefined }
      const abort = () => { const pending = binding.pending; finish(); pending?.reject(new Error('填写请求已取消；已发出的操作需重新检查页面结果')) }
      const timer = setTimeout(() => { const pending = binding.pending; finish(); pending?.reject(new Error('网页响应超时，请检查页面，不要盲目重复填写')) }, this.timeoutMs)
      binding.pending = { task: { id: randomBytes(16).toString('hex'), action, assignments, fieldId, command, deadline: Date.now() + this.timeoutMs }, issued: false,
        resolve: value => { finish(); resolve(value) }, reject, cleanup: finish }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })
  }
  private remove(ref: string, reason: string) {
    const pending = this.bindings.get(ref)?.pending
    if (pending) { pending.cleanup(); pending.reject(new Error(reason)) }
    this.bindings.delete(ref)
  }
  private sweep() { for (const [ref, binding] of this.bindings) if (Date.now() - binding.touched > 30 * 60 * 1000) this.remove(ref, '表单连接已过期') }
  dispose() { for (const ref of this.bindings.keys()) this.remove(ref, '表单助手已停用') }
}
