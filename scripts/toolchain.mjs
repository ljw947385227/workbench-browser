/** Reuse a matching Harness checkout without modifying its packages or profile. */
import { existsSync, symlinkSync, mkdirSync, readdirSync, lstatSync, unlinkSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
export const root = fileURLToPath(new URL('..', import.meta.url))
export const harness = resolve(process.env.ENWORK_HARNESS_SOURCE || join(root, '..', 'EnWork-Harness'))
export const harnessRequire = createRequire(join(harness, 'package.json'))
export function prepare() {
  const dependencies = join(harness, 'node_modules', '.pnpm', 'node_modules')
  if (!existsSync(dependencies)) throw new Error('Install the matching Harness workspace dependencies first, or set ENWORK_HARNESS_SOURCE')
  const destination = join(root, 'node_modules')
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) unlinkSync(destination)
  mkdirSync(destination, { recursive: true })
  const link = (from, to) => {
    if (existsSync(to)) {
      if (realpathSync(to) === realpathSync(from)) return
      if (!lstatSync(to).isSymbolicLink()) throw new Error(`Preserve existing dependency directory: ${to}`)
      unlinkSync(to)
    }
    symlinkSync(realpathSync(from), to, process.platform === 'win32' ? 'junction' : 'dir')
  }
  for (const source of [dependencies, join(harness, 'node_modules')]) {
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || !existsSync(join(source, entry.name))) continue
      if (entry.name.startsWith('@')) {
        mkdirSync(join(destination, entry.name), { recursive: true })
        for (const child of readdirSync(join(source, entry.name))) link(join(source, entry.name, child), join(destination, entry.name, child))
      } else if (entry.isDirectory() || entry.isSymbolicLink()) link(join(source, entry.name), join(destination, entry.name))
    }
  }
}
export function run(args, options = {}) {
  const child = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', ...options })
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(`Command failed: ${args[0]} (${child.status ?? child.signal})`)
}
