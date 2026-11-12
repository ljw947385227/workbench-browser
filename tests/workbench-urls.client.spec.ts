// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { sameWorkbenchOrigin, workbenchProtocol } from '../src/client/urls.ts'
it('supports the desktop application protocol as well as HTTP', () => {
  expect(workbenchProtocol(new URL('dsh-app://app/enwork/bid/app/'))).toBe(true)
  expect(workbenchProtocol(new URL('https://example.com/app/'))).toBe(true)
  expect(sameWorkbenchOrigin(new URL('dsh-app://app/enwork/bid/app/#/'), new URL('dsh-app://app/enwork/bid/app/#/new'))).toBe(true)
})
it('does not treat custom protocol null origins as interchangeable', () => {
  const app = new URL('dsh-app://app/enwork/bid/app/')
  for (const value of ['dsh-app://shell/', 'dsh-app://foreign/', 'file:///private', 'other://app/', 'https://app/', 'dsh-app://app:123/', 'dsh-app://user:secret@app/']) {
    expect(sameWorkbenchOrigin(app, new URL(value))).toBe(false)
  }
})
