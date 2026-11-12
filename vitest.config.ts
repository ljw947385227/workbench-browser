import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { defineConfig } from 'vitest/config'
const harness = resolve(process.env.ENWORK_HARNESS_SOURCE || '../EnWork-Harness')
const require = createRequire(resolve(harness, 'package.json'))
const { default: tsconfigPaths } = await import(pathToFileURL(require.resolve('vite-tsconfig-paths')).href)
const { standardDecoratorPlugin, vitestExecArgv } = await import(pathToFileURL(resolve(harness, 'vitest.shared.ts')).href)
export default defineConfig({
  plugins: [tsconfigPaths({ projects: [resolve(harness, 'tsconfig.base.json')] }), standardDecoratorPlugin()],
  test: { include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'], pool: 'forks', maxWorkers: 2,
    execArgv: vitestExecArgv, testTimeout: 10000 },
})
