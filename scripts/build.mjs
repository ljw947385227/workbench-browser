import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { root, prepare, harnessRequire, run } from './toolchain.mjs'
prepare()
run([harnessRequire.resolve('typescript/bin/tsc'), '-p', join(root, 'tsconfig.json')])
run(['--import', pathToFileURL(harnessRequire.resolve('tsx/esm')).href, join(root, 'scripts/build-worker.mjs')])
