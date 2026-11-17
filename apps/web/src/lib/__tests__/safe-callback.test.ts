import { describe, it, expect } from 'vitest'
import { safeCallbackPath } from '../safe-callback'

describe('safeCallbackPath', () => {
  it('accepts an in-app path under the same locale', () => {
    expect(safeCallbackPath('/sk/employer/jobs?x=1', 'sk')).toBe('/sk/employer/jobs?x=1')
  })

  it('rejects absolute and protocol-relative URLs (open redirect)', () => {
    expect(safeCallbackPath('https://evil.com/sk/dashboard', 'sk')).toBeNull()
    expect(safeCallbackPath('//evil.com/sk/dashboard', 'sk')).toBeNull()
    expect(safeCallbackPath('/\\evil.com', 'sk')).toBeNull()
    expect(safeCallbackPath('javascript:alert(1)', 'sk')).toBeNull()
  })

  it('rejects paths for another locale or without a locale', () => {
    expect(safeCallbackPath('/en/dashboard', 'sk')).toBeNull()
    expect(safeCallbackPath('/dashboard', 'sk')).toBeNull()
  })

  it('rejects the login page itself (redirect loop) and api routes', () => {
    expect(safeCallbackPath('/sk/login', 'sk')).toBeNull()
    expect(safeCallbackPath('/sk/login?error=forbidden', 'sk')).toBeNull()
    expect(safeCallbackPath('/api/auth/signout', 'sk')).toBeNull()
  })

  it('rejects dot-segment tricks that escape the locale or reach login/api', () => {
    expect(safeCallbackPath('/sk/../api/auth/signout', 'sk')).toBeNull()
    expect(safeCallbackPath('/sk/%2e%2e/api/auth/signout', 'sk')).toBeNull()
    expect(safeCallbackPath('/sk/../en/dashboard', 'sk')).toBeNull()
    expect(safeCallbackPath('/sk/%2e%2e/sk/login', 'sk')).toBeNull()
  })

  it('normalises harmless dot-segments inside the locale', () => {
    expect(safeCallbackPath('/sk/employer/./jobs', 'sk')).toBe('/sk/employer/jobs')
  })

  it('returns null for empty, array or non-string input', () => {
    expect(safeCallbackPath(undefined, 'sk')).toBeNull()
    expect(safeCallbackPath('', 'sk')).toBeNull()
    expect(safeCallbackPath(['/sk/dashboard'], 'sk')).toBeNull()
  })

  it('rejects control characters / header injection', () => {
    expect(safeCallbackPath('/sk/dashboard\r\nSet-Cookie: a=b', 'sk')).toBeNull()
  })
})
