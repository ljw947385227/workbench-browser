/** Electron registers dsh-app://app as the trusted application origin. URL.origin is 'null' for custom schemes. */
export function workbenchProtocol(url: URL): boolean {
  return ['http:', 'https:'].includes(url.protocol) || url.protocol === 'dsh-app:' && url.hostname === 'app' && !url.port && !url.username && !url.password
}
export function sameWorkbenchOrigin(left: URL, right: URL): boolean {
  return workbenchProtocol(left) && workbenchProtocol(right) && left.protocol === right.protocol && left.hostname === right.hostname && left.port === right.port && !left.username && !left.password && !right.username && !right.password
}
