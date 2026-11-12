import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { assignmentsSchema, BASE, descriptorSchema, type BrowserTask, type FillResult } from '../shared.ts'
import { discover, formTitle, LiveForm, type Target } from './dom.ts'
import { preferredFrame, scanFrames, watchFrames, type FrameCandidate } from './frames.ts'
import css from './style.module.css'
import { WorkbenchPage } from './page.ts'
import { pageCommandSchema } from '../shared.ts'

export const ACTIVATE = 'enwork:form-assist:activate'
export const OPEN = 'enwork:form-assist:open'
export const READY = '__enworkFormAssistReadyV1'
async function post(path: string, body: unknown, signal?: AbortSignal): Promise<any> {
  const response = await fetch(BASE + path, { method: 'POST', credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const answer = await response.json()
  if (!response.ok) throw new Error(answer.error || '表单助手连接失败')
  return answer
}
interface Bound { page: WorkbenchPage; formRef: string; secret: string; binding: NonNullable<ReturnType<Context['uiWorkspace']['currentSession']>> }
export function Assistant({ ctx, launcher = true }: { ctx: Context; launcher?: boolean }) {
  const [target, setTarget] = useState<Target>()
  const [candidates, setCandidates] = useState<HTMLElement[]>([])
  const [choice, setChoice] = useState(0)
  const [bound, setBound] = useState<Bound>()
  const [status, setStatus] = useState('')
  const [failure, setFailure] = useState('')
  const [report, setReport] = useState<FillResult>()
  const [busy, setBusy] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [opened, setOpened] = useState(false)
  const [automatic, setAutomatic] = useState(false)
  const [frames, setFrames] = useState<FrameCandidate[]>([])
  const recentlyFocused = useRef<HTMLIFrameElement | undefined>(undefined)
  const generation = useRef(0)
  const executing = useRef(false)
  const selectTarget = (next: Target, automatic: boolean) => {
    generation.current++; setBound(undefined); setReport(undefined); setFailure(''); setCollapsed(false); setOpened(true); setAutomatic(automatic); setTarget(next); setChoice(0)
    try { const forms = discover(next); setCandidates(forms); setStatus(forms.length ? `发现 ${forms.length} 张表单，请关联后在聊天里输入资料。` : '当前尚无表单。可以先关联网页，让 Agent 按要求导航到填写页面。') }
    catch (error) { setCandidates([]); setFailure((error as Error).message) }
  }
  const openPicker = () => {
    generation.current++; setBound(undefined); setReport(undefined); setFailure(''); setOpened(true); setAutomatic(true); setCollapsed(false); setTarget(undefined); setCandidates([])
    const candidates = scanFrames(document)
    setFrames(candidates)
    const recent = candidates.find(candidate => candidate.frame === recentlyFocused.current && candidate.accessible && candidate.forms.length > 0)
    const preferred = recent || preferredFrame(candidates)
    if (preferred) selectTarget({ frame: preferred.frame, title: preferred.title }, true)
    else setStatus(candidates.length ? '检测到多个网页或受限页面，请选择要操作的工作台。' : '未发现可见的 iframe。请先打开网页工作台，助手会自动更新列表。')
  }
  useEffect(() => {
    Reflect.set(window, READY, true)
    const activate = (event: Event) => {
      const detail = (event as CustomEvent).detail as { frame?: HTMLIFrameElement; root?: HTMLElement; title?: string }
      if (detail?.frame && !(detail.frame instanceof HTMLIFrameElement) || detail?.root && !(detail.root instanceof HTMLElement)) return
      if (!detail?.frame && !detail?.root) return
      const next: Target = { frame: detail.frame, root: detail.root, title: String(detail.title || '网页工作台').slice(0, 300) }
      selectTarget(next, false)
    }
    const stop = watchFrames(document, candidates => { const focused = candidates.filter(candidate => candidate.focused).at(-1); if (focused) recentlyFocused.current = focused.frame; setFrames(candidates) })
    window.addEventListener(ACTIVATE, activate)
    window.addEventListener(OPEN, openPicker)
    return () => { generation.current++; stop(); Reflect.deleteProperty(window, READY); window.removeEventListener(ACTIVATE, activate); window.removeEventListener(OPEN, openPicker) }
  }, [])
  useEffect(() => {
    if (!opened || !automatic || bound || !target?.frame) return
    const candidate = frames.find(candidate => candidate.frame === target.frame)
    if (!candidate?.accessible) { setCandidates([]); setStatus('该网页已关闭、隐藏或无法读取，请重新选择工作台。'); return }
    try {
      const next = discover(target)
      setCandidates(old => old.length === next.length && old.every((element, i) => element === next[i]) ? old : next)
      if (choice >= next.length) setChoice(0)
      setStatus(next.length ? `发现 ${next.length} 张表单，请关联后在聊天里输入资料。` : '当前尚无表单。可以先关联网页，让 Agent 导航到填写页面。')
    } catch (error) { setCandidates([]); setFailure((error as Error).message) }
  }, [frames, target, opened, automatic, bound, choice])
  useEffect(() => {
    if (!bound) return
    const controller = new AbortController()
    const key = { formRef: bound.formRef, secret: bound.secret }
    let timer: ReturnType<typeof setTimeout> | undefined
    const boundGeneration = generation.current
    const assert = () => { controller.signal.throwIfAborted(); if (generation.current !== boundGeneration) throw new Error('填写任务已切换，请重新关联'); if (ctx.uiWorkspace.currentSession() !== bound.binding) throw new Error('当前对话已切换，请重新关联表单'); bound.page.assertConnected() }
    const poll = async () => {
      try {
        assert()
        const answer = await post('/poll', key, controller.signal)
        const task = answer.task as BrowserTask | null
        if (task) {
          let result: unknown
          let acquired = false
          try {
            assert()
            if (Date.now() >= task.deadline) throw new Error('任务已过期，请重新检查表单')
            if (executing.current) throw new Error('页面正在执行另一个选择任务，请稍后重试')
            executing.current = true; acquired = true
            const interaction = { assert, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, task.deadline - Date.now()))]) }
            if (task.action === 'page') { result = await bound.page.execute(pageCommandSchema.parse(task.command), interaction); setReport(undefined) }
            else if (!bound.page.live) throw new Error('请先使用 workbench_browser snapshot，再用 form 选择当前表单')
            else if (task.action === 'inspect') result = descriptorSchema.parse(bound.page.live.describe())
            else if (task.action === 'options') result = await bound.page.live.options(task.fieldId || '', interaction)
            else if (task.action === 'fill') {
              const filled = await bound.page.live.apply(assignmentsSchema.parse(task.assignments), false, interaction)
              setReport(filled); setCollapsed(false)
              const count = filled.fields.filter(field => field.status === 'filled').length
              setStatus(`已填写 ${count} 项；${filled.fields.filter(field => field.status === 'conflict').length} 项有冲突。请检查网页。`)
              result = filled
            } else throw new Error('未知填写动作')
          } catch (error) { result = { error: (error as Error).message, nextStep: '请重新关联或检查当前网页；不要宣称填写成功。' } }
          finally { if (acquired) executing.current = false }
          await post('/result', { ...key, taskId: task.id, result }, controller.signal)
        }
        if (!controller.signal.aborted) timer = setTimeout(() => { void poll() }, 1000)
      } catch (error) { if (!controller.signal.aborted) { setFailure((error as Error).message); setBound(undefined); setCollapsed(false) } }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer); void post('/release', key).catch(() => {}) }
  }, [bound, ctx])
  const bind = async () => {
    if (!target) return
    const binding = ctx.uiWorkspace.currentSession()
    if (!binding) { setFailure('请先打开一个对话，并在对话右侧工作台操作'); return }
    const revision = ++generation.current
    setBusy(true); setFailure(''); setBound(undefined); setReport(undefined)
    let remote: { formRef: string; secret: string } | undefined
    try {
      const page = new WorkbenchPage(target, candidates[choice])
      page.assertCurrent()
      const descriptor = descriptorSchema.parse(page.live?.describe() || { title: target.title, page: '', fields: [] })
      remote = await post('/bind', { sessionId: binding.sessionId, descriptor })
      if (revision !== generation.current || ctx.uiWorkspace.currentSession() !== binding) throw new Error('页面或对话已切换，请重新关联')
      page.assertCurrent()
      const text = `\n[工作台浏览器引用：${remote!.formRef}]\n目标是当前工作台 iframe「${descriptor.title}」。请使用 workbench_browser snapshot 观察网页，按我的要求导航；找到表单后用 form 选择，再使用 form_assist 读取选项并填写。请沿用这个工作台的登录状态。${descriptor.fields.length ? `当前字段：${descriptor.fields.map(field => field.label).join('、')}。` : '当前尚未打开表单。'}\n`
      const applied = ctx.conversation.input.requestDraftInitialization(binding, { whenDraftExists: 'append', prompt: { text, references: [] } })
      if (applied !== 'applied') throw new Error('当前输入框无法追加表单引用，请稍后重试')
      setBound({ page, ...remote!, binding }); setStatus('已关联。在聊天框中补充资料并发送，Agent 会调用工具填写。'); setCollapsed(false)
      ctx.conversation.input.for(binding.ctx).focus()
    } catch (error) { if (remote) void post('/release', remote).catch(() => {}); setFailure((error as Error).message) }
    finally { setBusy(false) }
  }
  const approveConflicts = async () => {
    if (executing.current) { setFailure('页面正在处理选择任务，请稍后确认'); return }
    executing.current = true; setBusy(true)
    const revision = generation.current
    try {
      if (!bound?.page.live || ctx.uiWorkspace.currentSession() !== bound.binding) throw new Error('当前对话或表单已变化，请重新关联')
      const conflicts = report?.fields.filter(field => field.status === 'conflict') || []
      const now = bound.page.live.describe()
      if (conflicts.some(field => now.fields.find(current => current.fieldId === field.fieldId)?.value !== field.previous)) throw new Error('字段已被修改，请让 Agent 重新检查后再填写')
      const filled = await bound.page.live.apply(conflicts.map(({ fieldId, value }) => ({ fieldId, value })), true, { assert: () => { if (revision !== generation.current || ctx.uiWorkspace.currentSession() !== bound.binding) throw new Error('页面或对话已切换，后续操作已停止'); bound.page.assertCurrent() } })
      setReport(filled); setFailure(''); setStatus('替换已执行，请检查实际填写结果。')
    } catch (error) { setFailure((error as Error).message) }
    finally { executing.current = false; setBusy(false) }
  }
  const conflicts = report?.fields.filter(field => field.status === 'conflict') || []
  if (!opened) return launcher ? <button type='button' className={css.launcher} onClick={openPicker}>工作台浏览器助手{frames.length > 0 ? ` · ${frames.length} 个网页` : ''}</button> : null
  const selectedFrame = frames.find(candidate => candidate.frame === target?.frame)
  let recognized: ReturnType<LiveForm['describe']>['fields'] = []
  try { if (bound) recognized = bound.page.live?.describe().fields || []; else if (target && candidates[choice]) recognized = new LiveForm(target, candidates[choice]!).describe().fields } catch { /* lifecycle notice is reported by the polling/binding path */ }
  return <aside className={css.dock} aria-label='工作台浏览器助手'>
    <header><strong>工作台浏览器助手 · {target?.title || '当前工作台'}</strong><button type='button' onClick={() => setCollapsed(value => !value)}>{collapsed ? '展开' : '收起'}</button><button type='button' onClick={() => { generation.current++; setBound(undefined); setTarget(undefined); setOpened(false) }}>关闭</button></header>
    {!collapsed && <div className={css.body}>
      {automatic && <label>网页工作台<select aria-label='网页工作台' disabled={!!bound || busy} value={selectedFrame?.id || ''} onChange={event => { const candidate = frames.find(candidate => candidate.id === event.target.value); if (candidate?.accessible) selectTarget({ frame: candidate.frame, title: candidate.title }, true) }}><option value=''>请选择当前网页</option>{frames.map(candidate => <option key={candidate.id} value={candidate.id} disabled={!candidate.accessible}>{candidate.title} · {candidate.accessible ? `${candidate.forms.length} 张表单${candidate.focused ? ' · 当前焦点' : ''}` : candidate.reason}</option>)}</select></label>}
      <p role='status'>{status}</p>
      {recognized.length > 0 && <details><summary>识别到的字段（{recognized.length}）</summary><ul>{recognized.map(field => <li key={field.fieldId}>{field.label} · {field.type}{field.optionsState === 'needs-open' ? ' · 可展开读取选项' : ''}</li>)}</ul></details>}
      {failure && <p role='alert' className={css.error}>{failure}</p>}
      {!bound && candidates.length > 0 && <><label>要填写的表单<select aria-label='要填写的表单' value={choice} onChange={event => setChoice(Number(event.target.value))}>{candidates.map((element, index) => <option key={index} value={index}>{formTitle(element, index)}</option>)}</select></label><button type='button' disabled={busy} onClick={() => { void bind() }}>{busy ? '正在关联…' : '关联到当前聊天'}</button></>}
      {!bound && target && candidates.length === 0 && <button type='button' disabled={busy} onClick={() => { void bind() }}>关联到当前聊天</button>}
      {report && <><ul>{report.fields.map(field => <li key={field.fieldId}>{field.label}：{field.status === 'filled' ? `已填 ${field.value}` : field.status === 'conflict' ? `${field.previous} → ${field.value}（待确认）` : field.status === 'unchanged' ? '已是目标值' : `未填写：${field.reason}`}</li>)}</ul>{report.missing.length > 0 && <p>还缺：{report.missing.join('、')}</p>}</>}
      {conflicts.length > 0 && <button type='button' disabled={busy} onClick={() => { void approveConflicts() }}>确认替换以上 {conflicts.length} 项</button>}
      <button type='button' onClick={openPicker}>重新检测网页</button>
      <small>填写后在原网页核对，保存与提交由你完成。</small>
    </div>}
  </aside>
}
