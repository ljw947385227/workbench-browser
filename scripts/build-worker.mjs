import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { root, harness, harnessRequire } from './toolchain.mjs'
const { clientBundle } = await import(pathToFileURL(join(harness, 'packages/client/tsdown.client.ts')).href)
const { build } = await import(pathToFileURL(harnessRequire.resolve('tsdown')).href)
for (const config of clientBundle(root, ['lib/types/index.js'])({ env: {} })) await build({ ...config, cwd: root, config: false, clean: false })
