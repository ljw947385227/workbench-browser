export function visible(element: Element): boolean {
  if (!element.isConnected || element.closest('[hidden],[inert],[aria-hidden="true"]')) return false
  const view = element.ownerDocument.defaultView
  if (!view || !element.getClientRects().length) return false
  for (let parent: Element | null = element; parent; parent = parent.parentElement) {
    const style = view.getComputedStyle(parent)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false
  }
  try { if (view.frameElement && !visible(view.frameElement)) return false } catch { return false }
  return true
}
