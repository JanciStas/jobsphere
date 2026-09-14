/**
 * Protected paths without a locale prefix must redirect to a real login URL.
 *
 * `/dashboard` used to be read as locale "dashboard", producing a redirect to
 * `/dashboard/login` — itself a protected path — and therefore an infinite
 * redirect loop (ERR_TOO_MANY_REDIRECTS) for every bookmark or emailed link
 * that omitted `/sk/`. Verified live on production before the fix.
 */

import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn().mockResolvedValue(null) }))
vi.mock('next-intl/middleware', () => ({
  default: () => () => NextResponse.next(),
}))

import middleware from '../middleware'

const location = (res: Response) => new URL(res.headers.get('location') ?? '', 'http://x').pathname

describe('middleware: anonymous access to protected routes', () => {
  it.each(['/dashboard', '/employer', '/admin', '/settings', '/profile'])(
    'redirects locale-less %s to the default-locale login, not into a loop',
    async (path) => {
      const res = await middleware(new NextRequest(`http://localhost:3000${path}`))
      expect(res.status).toBe(307)
      expect(location(res)).toBe('/sk/login')
    },
  )

  it('keeps a valid locale prefix', async () => {
    const res = await middleware(new NextRequest('http://localhost:3000/en/dashboard'))
    expect(location(res)).toBe('/en/login')
  })

  it('never redirects to a path that is itself protected', async () => {
    const res = await middleware(new NextRequest('http://localhost:3000/dashboard/reports'))
    expect(location(res)).not.toMatch(/^\/dashboard/)
  })
})
