import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { assignmentsSchema, BASE, VERSION, descriptorSchema, pageCommandSchema, type BrowserTask } from '../shared.ts'
import { scanFrames, watchFrames, type FrameCandidate } from './frames.ts'
import { discover } from './dom.ts'
import { WorkbenchPage } from './page.ts'
import { workbenchProtocol } from './urls.ts'
import { OperationGuard } from './operation-guard.ts'

type Session = NonNullable<ReturnType<Context['uiWorkspace']['currentSession']>>
interface Key { formRef: string; secret: string }
interface Lease { candidate: FrameCandidate; binding: Session; page: WorkbenchPage; controller: AbortController; guard?: OperationGuard; paused?: boolean; resuming?: boolean; pauseSync?: Promise<void>; active?: AbortController; key?: Key; timer?: ReturnType<typeof setTimeout> }
/** Read the Harness-owned session boundary, including the owning chain of nested frames. */
export function belongsToSession(frame: HTMLIFrameElement, sessionId: string): boolean {
  let element: Element | null = frame
  for (let depth = 0; element && depth < 6; depth++) {
    const owner = element.closest('[data-sidebar-right-session]')
    if (owner) return owner.getAttribute('data-sidebar-right-session') === sessionId
    try { element = element.ownerDocument.defaultView?.frameElement || null } catch { return false }
  }
  return false
}
async function post(path: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch(BASE + path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || '工作台连接失败')
  return value
}
/** Discovery sends page metadata only: no launcher, draft edits or page interactions. */
export function startAutomatic(ctx: Context, document: Document = window.document): () => void {
  const leases = new Map<HTMLIFrameElement, Lease>()
  let stopped = false
  const release = (lease: Lease) => {
    lease.controller.abort(); clearTimeout(lease.timer)
    lease.active?.abort(); lease.guard?.dispose()
    if (leases.get(lease.candidate.frame) === lease) leases.delete(lease.candidate.frame)
    if (lease.key) void post('/release', lease.key).catch(() => {})
  }
  const assert = (lease: Lease) => {
    lease.controller.signal.throwIfAborted()
    if (stopped || ctx.uiWorkspace.currentSession() !== lease.binding || !belongsToSession(lease.candidate.frame, lease.binding.sessionId)) throw new Error('当前对话或工作台归属已变化，操作已停止')
    lease.page.assertConnected()
  }
  const poll = async (lease: Lease) => {
    try {
      assert(lease)
      const { task } = await post('/poll', lease.key, lease.controller.signal) as { task: BrowserTask | null }
      if (task) {
        let result: unknown
        try {
          assert(lease)
          if (Date.now() >= task.deadline) throw new Error('操作已过期，请重新观察网页')
          if (lease.paused) throw new Error('用户已接管网页，请等待用户允许 Agent 继续')
          lease.active = new AbortController()
          const interaction = { assert: () => { assert(lease); if (lease.paused) throw new Error('用户已停止并接管网页，后续操作已取消') }, signal: AbortSignal.any([lease.controller.signal, lease.active.signal, AbortSignal.timeout(Math.max(1, task.deadline - Date.now()))]) }
          const command = task.action === 'page' ? pageCommandSchema.parse(task.command) : undefined
          const mutating = task.action === 'fill' || task.action === 'options' || command && ['begin', 'click', 'hover', 'scroll', 'navigate'].includes(command.action)
          if (mutating) lease.guard?.busy(task.action === 'fill' ? `填写 ${task.assignments.length} 个字段` : task.action === 'options' ? '读取选择项' : command?.action === 'begin' ? '准备操作网页' : '导航与操作网页')
          if (command?.action === 'begin') result = { locked: true, nextStep: '连续操作结束后必须调用 finish 释放锁定' }
          else if (command?.action === 'finish') { lease.guard?.finish(); result = { unlocked: true, note: '请用户核对网页；未执行保存或提交' } }
          else if (command) result = await lease.page.execute(command, interaction)
          else {
            if (!lease.page.live && task.action === 'inspect') {
              const forms = discover(lease.page.target)
              if (forms.length === 1) {
                const snapshot = lease.page.snapshot()
                await lease.page.execute({ action: 'form', nodeRef: snapshot.forms[0]!.nodeRef }, interaction)
              }
            }
            const live = lease.page.live
            if (!live) throw new Error('请先 snapshot，打开表单后使用 form 选择要填写的表单')
            if (task.action === 'inspect') result = descriptorSchema.parse(live.describe())
            else if (task.action === 'options') result = await live.options(task.fieldId || '', interaction)
            else if (task.action === 'fill') {
              result = await live.apply(assignmentsSchema.parse(task.assignments), false, interaction)
            } else throw new Error('未知工作台动作')
          }
        } catch (error) { if (!lease.paused) lease.guard?.finish('操作已停止 · 请检查网页结果'); result = { error: (error as Error).message, clientVersion: VERSION, nextStep: lease.paused ? '用户已接管，请等待允许继续；已完成步骤未回滚。' : '请重新读取当前聊天的工作台页面，不要宣称操作成功。' } }
        finally { lease.active = undefined; if (lease.paused) lease.guard?.takenOver(); else if (!(task.action === 'page' && task.command?.action === 'finish')) lease.guard?.waiting() }
        assert(lease)
        await post('/result', { ...lease.key, taskId: task.id, result }, lease.controller.signal)
      }
      lease.timer = setTimeout(() => { void poll(lease) }, 750)
    } catch { release(lease) }
  }
  const bind = async (lease: Lease) => {
    try {
      assert(lease)
      const page = lease.candidate.document!.location
      lease.key = await post('/bind', { sessionId: lease.binding.sessionId, automatic: true, clientVersion: VERSION,
        descriptor: { title: lease.candidate.title, page: (page.pathname + page.hash).slice(0, 500), fields: [] } }, lease.controller.signal)
      assert(lease)
      const takeOver = () => {
        if (lease.paused) return
        lease.paused = true; lease.guard?.stopping(); lease.active?.abort(new Error('用户已停止并接管网页'))
        if (!lease.active) lease.guard?.takenOver()
        lease.pauseSync = post('/pause', lease.key).then(() => {}, () => {})
      }
      const resume = () => { void (async () => {
        if (lease.resuming) return
        lease.resuming = true; lease.guard?.resuming()
        try { assert(lease); await lease.pauseSync; assert(lease); await post('/resume', lease.key, lease.controller.signal); assert(lease); lease.page.invalidate(); lease.paused = false; lease.guard?.reset() }
        catch { lease.guard?.takenOver() }
        finally { lease.resuming = false }
      })() }
      lease.guard = new OperationGuard(lease.candidate.frame, takeOver, resume)
      void poll(lease)
    } catch { release(lease) }
  }
  const reconcile = () => {
    if (stopped) return
    const binding = ctx.uiWorkspace.currentSession()
    const candidates = binding ? scanFrames(document).filter(candidate => {
      if (!candidate.accessible || !belongsToSession(candidate.frame, binding.sessionId)) return false
      const doc = candidate.document!
      // src can be assigned AFTER the iframe is mounted. Never advertise its initial empty document.
      if (doc.readyState === 'loading') return false
      return workbenchProtocol(new URL(doc.location.href)) || doc.location.href === 'about:srcdoc' && candidate.frame.hasAttribute('srcdoc')
    }) : []
    // Avoid advertising the same mounted workbench twice through its nested frames.
    const available = candidates.filter(candidate => !candidates.some(parent => parent !== candidate && parent.document === candidate.frame.ownerDocument))
    const current = new Set(available.map(candidate => candidate.frame))
    for (const lease of leases.values()) if (!current.has(lease.candidate.frame) || lease.binding !== binding) release(lease)
    for (const candidate of available) if (!leases.has(candidate.frame)) {
      try {
        const lease: Lease = { candidate, binding: binding!, page: new WorkbenchPage({ frame: candidate.frame, title: candidate.title }), controller: new AbortController() }
        leases.set(candidate.frame, lease); void bind(lease)
      } catch { /* inaccessible/loading pages are reconsidered on the next scan */ }
    }
  }
  const stopWatching = watchFrames(document, reconcile)
  const timer = setInterval(reconcile, 1000)
  reconcile()
  return () => { stopped = true; clearInterval(timer); stopWatching(); for (const lease of leases.values()) release(lease) }
}
