/** /admin is for global admins only; non-admins go to the admin login with ?error=forbidden. */
import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('next-intl/middleware', () => ({ default: () => () => NextResponse.next() }))

import middleware from '../middleware'

describe('middleware: /admin', () => {
  it('redirects a signed-in non-admin to /login/admin?error=forbidden', async () => {
    getToken.mockResolvedValue({ sub: 'u', isGlobalAdmin: false })
    const res = await middleware(new NextRequest('http://localhost:3000/en/admin/users'))
    const loc = new URL(res.headers.get('location') ?? '', 'http://x')
    expect(loc.pathname).toBe('/en/login/admin')
    expect(loc.searchParams.get('error')).toBe('forbidden')
  })
  it('lets a global admin through', async () => {
    getToken.mockResolvedValue({ sub: 'u', isGlobalAdmin: true })
    const res = await middleware(new NextRequest('http://localhost:3000/en/admin'))
    expect(res.headers.get('location')).toBeNull()
  })
})
