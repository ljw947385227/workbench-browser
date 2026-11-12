import { discover, visible } from './dom.ts'
export interface FrameCandidate {
  id: string; frame: HTMLIFrameElement; title: string; accessible: boolean; reason?: string
  focused: boolean; forms: HTMLElement[]; document?: Document
}
const ids = new WeakMap<HTMLIFrameElement, string>()
let sequence = 0
function frameId(frame: HTMLIFrameElement) { let id = ids.get(frame); if (!id) { id = `workbench-${++sequence}`; ids.set(frame, id) } return id }
function onScreen(frame: HTMLIFrameElement): boolean {
  if (!visible(frame)) return false
  const rect = frame.getBoundingClientRect(), view = frame.ownerDocument.defaultView!
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < view.innerHeight && rect.left < view.innerWidth
}
function fallbackTitle(frame: HTMLIFrameElement): string {
  const title = frame.getAttribute('title') || frame.getAttribute('aria-label')
  if (title?.trim()) return title.trim().slice(0, 200)
  try { const url = new URL(frame.getAttribute('src') || '', frame.ownerDocument.baseURI); return (url.host + url.pathname).slice(0, 200) || '未命名网页' } catch { return '未命名网页' }
}
/** Local discovery only: no network, field values, binding or model calls. */
export function scanFrames(document: Document): FrameCandidate[] {
  const result: FrameCandidate[] = []
  const seen = new Set<Document>()
  const visit = (scope: Document, depth: number, focused: boolean) => {
    if (depth > 4 || seen.has(scope)) return
    seen.add(scope)
    for (const frame of scope.querySelectorAll<HTMLIFrameElement>('iframe')) {
      if (result.length >= 64) return
      if (!onScreen(frame)) continue
      const candidate: FrameCandidate = { id: frameId(frame), frame, title: fallbackTitle(frame), accessible: false, focused: focused && scope.activeElement === frame, forms: [] }
      result.push(candidate)
      try {
        const child = frame.contentDocument
        if (!child?.body || !child.defaultView) { candidate.reason = '跨域、沙箱隔离或网页尚未加载'; continue }
        candidate.document = child
        candidate.accessible = true
        if (!frame.getAttribute('title') && child.title.trim()) candidate.title = child.title.trim().slice(0, 200)
        candidate.forms = discover({ frame, title: candidate.title })
        visit(child, depth + 1, candidate.focused)
      } catch { candidate.accessible = false; candidate.reason = '浏览器禁止读取此网页，可能是跨域或沙箱隔离'; candidate.document = undefined }
    }
  }
  visit(document, 0, true)
  return result.sort((a, b) => Number(b.focused) - Number(a.focused) || Number(b.accessible && b.forms.length > 0) - Number(a.accessible && a.forms.length > 0))
}
export function preferredFrame(candidates: FrameCandidate[]): FrameCandidate | undefined {
  const available = candidates.filter(candidate => candidate.accessible && candidate.forms.length > 0)
  const focused = available.filter(candidate => candidate.focused)
  if (focused.length === 1) return focused[0]
  if (available.length === 1) return available[0]
  const readable = candidates.filter(candidate => candidate.accessible)
  return readable.length === 1 ? readable[0] : undefined
}
/** Tracks frame mount/unmount, visibility, load, nested documents and SPA form replacement. */
export function watchFrames(document: Document, changed: (candidates: FrameCandidate[]) => void): () => void {
  let previous: FrameCandidate[] = []
  let stopped = false
  let debounce: ReturnType<typeof setTimeout> | undefined
  const observers = new Map<Document, MutationObserver>()
  const loads = new Map<HTMLIFrameElement, () => void>()
  const schedule = () => { if (!stopped && !debounce) debounce = setTimeout(() => { debounce = undefined; scan() }, 100) }
  const scan = () => {
    if (stopped) return
    const next = scanFrames(document)
    const docs = new Set([document, ...next.flatMap(candidate => candidate.document ? [candidate.document] : [])])
    for (const [doc, observer] of observers) if (!docs.has(doc)) { observer.disconnect(); doc.removeEventListener('focusin', schedule); observers.delete(doc) }
    for (const doc of docs) if (!observers.has(doc)) {
      const observer = new doc.defaultView!.MutationObserver(schedule)
      observer.observe(doc, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'inert', 'aria-hidden', 'title', 'src'] })
      doc.addEventListener('focusin', schedule); observers.set(doc, observer)
    }
    const frames = new Set(next.map(candidate => candidate.frame))
    for (const [frame, listener] of loads) if (!frames.has(frame)) { frame.removeEventListener('load', listener); loads.delete(frame) }
    for (const frame of frames) if (!loads.has(frame)) { frame.addEventListener('load', schedule); loads.set(frame, schedule) }
    const same = next.length === previous.length && next.every((candidate, index) => {
      const old = previous[index]!
      return old.frame === candidate.frame && old.title === candidate.title && old.document === candidate.document && old.accessible === candidate.accessible && old.focused === candidate.focused
        && old.forms.length === candidate.forms.length && old.forms.every((form, i) => form === candidate.forms[i])
    })
    if (!same) { previous = next; changed(next) }
  }
  scan()
  const interval = setInterval(scan, 1500)
  return () => { stopped = true; clearTimeout(debounce); clearInterval(interval); for (const [doc, observer] of observers) { observer.disconnect(); doc.removeEventListener('focusin', schedule) } for (const [frame, listener] of loads) frame.removeEventListener('load', listener) }
}
