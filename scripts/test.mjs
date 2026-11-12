import { root, harnessRequire, prepare, run } from './toolchain.mjs'
import { dirname, join } from 'node:path'
prepare()
run([join(dirname(harnessRequire.resolve('vitest/package.json')), 'vitest.mjs'), 'run', ...process.argv.slice(2)], { cwd: root })
