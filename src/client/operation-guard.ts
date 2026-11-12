/** A target-local interaction shield. Programmatic DOM operations remain available to the driver. */
export class OperationGuard {
  private panel: HTMLDivElement
  private label: HTMLSpanElement
  private button: HTMLButtonElement
  private mask: HTMLDivElement
  private timer?: ReturnType<typeof setTimeout>
  private watchdog?: ReturnType<typeof setTimeout>
  private savedPointer: string
  private savedTab: string | null
  private locked = false
  private paused = false
  private cleanups: (() => void)[] = []
  constructor(private frame: HTMLIFrameElement, private stop: () => void, private resume: () => void) {
    const doc = frame.ownerDocument
    this.panel = doc.createElement('div'); this.panel.setAttribute('role', 'region'); this.panel.setAttribute('aria-label', 'Agent 网页操作状态')
    Object.assign(this.panel.style, { position: 'fixed', zIndex: '2147483001', display: 'flex', alignItems: 'center', gap: '12px', boxSizing: 'border-box', padding: '10px 14px', background: '#f1f6ff', border: '1px solid #b9cdf3', borderRadius: '10px', color: '#243c61', font: '13px system-ui', boxShadow: '0 3px 12px #20305020' })
    this.label = doc.createElement('span'); this.label.setAttribute('role', 'status'); this.label.setAttribute('aria-live', 'polite'); this.label.style.flex = '1'
    this.button = doc.createElement('button'); this.button.type = 'button'
    Object.assign(this.button.style, { padding: '7px 11px', border: '1px solid #aac0e6', borderRadius: '7px', background: '#fff', color: '#234978', cursor: 'pointer', whiteSpace: 'nowrap' })
    this.button.onclick = () => { if (this.paused) this.resume(); else this.stop() }
    this.panel.append(this.label, this.button)
    this.mask = doc.createElement('div'); this.mask.setAttribute('aria-hidden', 'true')
    Object.assign(this.mask.style, { position: 'fixed', zIndex: '2147483000', background: '#edf3fb38', cursor: 'progress', pointerEvents: 'auto' })
    this.mask.addEventListener('wheel', event => event.preventDefault(), { passive: false })
    this.savedPointer = frame.style.pointerEvents
    this.savedTab = frame.getAttribute('tabindex')
    const block = (event: Event) => {
      if (!this.locked || !event.isTrusted) return
      if ((event as KeyboardEvent).key === 'Escape') this.stop()
      event.preventDefault(); event.stopImmediatePropagation()
    }
    const attach = () => {
      try {
        const visit = (scope: Document, depth = 0) => {
          if (depth > 4) return
          for (const type of ['keydown', 'keyup', 'beforeinput', 'paste', 'drop', 'pointerdown', 'click']) {
            scope.addEventListener(type, block, true); this.cleanups.push(() => scope.removeEventListener(type, block, true))
          }
          for (const child of scope.querySelectorAll('iframe')) if (child.contentDocument) visit(child.contentDocument, depth + 1)
        }
        if (frame.contentDocument) visit(frame.contentDocument)
      } catch { /* the page driver separately rejects inaccessible navigation */ }
    }
    attach(); frame.addEventListener('load', attach); this.cleanups.push(() => frame.removeEventListener('load', attach))
    const layout = () => this.layout()
    doc.defaultView!.addEventListener('resize', layout); doc.addEventListener('scroll', layout, true)
    this.cleanups.push(() => { doc.defaultView!.removeEventListener('resize', layout); doc.removeEventListener('scroll', layout, true) })
  }
  private layout() {
    const rect = this.frame.getBoundingClientRect(), view = this.frame.ownerDocument.defaultView!
    let left = Math.max(0, rect.left), top = Math.max(0, rect.top), right = Math.min(view.innerWidth, rect.right), bottom = Math.min(view.innerHeight, rect.bottom)
    for (let parent = this.frame.parentElement; parent; parent = parent.parentElement) {
      const style = view.getComputedStyle(parent), clip = parent.getBoundingClientRect()
      if (/hidden|clip|auto|scroll/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right) }
      if (/hidden|clip|auto|scroll/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom) }
    }
    Object.assign(this.mask.style, { left: `${left}px`, top: `${top}px`, width: `${Math.max(0, right - left)}px`, height: `${Math.max(0, bottom - top)}px` })
    Object.assign(this.panel.style, { left: `${left + 8}px`, top: `${top + 8}px`, width: `${Math.max(0, right - left - 16)}px` })
  }
  busy(text: string) {
    clearTimeout(this.timer); clearTimeout(this.watchdog)
    this.locked = true; this.paused = false
    this.frame.style.pointerEvents = 'none'
    this.frame.setAttribute('tabindex', '-1')
    this.label.textContent = `Agent 正在操作 · ${text}（网页暂时锁定）`; this.button.textContent = '停止并接管'; this.button.disabled = false
    this.button.style.display = ''
    this.frame.ownerDocument.body.append(this.mask, this.panel); this.layout()
    if (this.frame.ownerDocument.activeElement === this.frame) this.button.focus({ preventScroll: true })
    this.watchdog = setTimeout(() => this.stop(), 90000)
  }
  waiting() { if (this.locked) this.label.textContent = 'Agent 正在处理 · 等待下一步（网页暂时锁定）' }
  stopping() { clearTimeout(this.watchdog); this.label.textContent = '正在停止 · 等待当前操作退出'; this.button.disabled = true }
  resuming() { this.label.textContent = '正在恢复连接 · 将重新读取网页'; this.button.disabled = true }
  private unlock() { this.locked = false; this.frame.style.pointerEvents = this.savedPointer; if (this.savedTab === null) this.frame.removeAttribute('tabindex'); else this.frame.setAttribute('tabindex', this.savedTab); this.mask.remove(); clearTimeout(this.watchdog) }
  takenOver() { this.unlock(); this.paused = true; this.label.textContent = '已接管 · 网页可操作，自动操作已暂停'; this.button.textContent = '允许 Agent 继续'; this.button.disabled = false; this.frame.ownerDocument.body.append(this.panel); this.layout() }
  finish(text = '当前操作完成 · 请核对网页') { this.unlock(); this.label.textContent = text; this.button.style.display = 'none'; this.timer = setTimeout(() => this.panel.remove(), 2400) }
  reset() { this.paused = false; this.button.style.display = ''; this.panel.remove(); clearTimeout(this.timer) }
  dispose() { this.unlock(); this.panel.remove(); clearTimeout(this.timer); for (const cleanup of this.cleanups) cleanup() }
}
