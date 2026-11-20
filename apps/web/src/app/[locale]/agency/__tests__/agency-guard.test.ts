import { describe, it, expect, vi, beforeEach } from 'vitest'

class RedirectError extends Error {
  constructor(public url: string) {
    super(`REDIRECT:${url}`)
  }
}
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectError(url)
  },
}))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { userOrgRole: { findMany: vi.fn() } } }))

import { requireAgency } from '../_lib/agency-context'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>
const redirectTarget = async () => {
  try {
    await requireAgency('sk')
  } catch (e) {
    if (e instanceof RedirectError) return e.url
    throw e
  }
  return null
}

beforeEach(() => vi.clearAllMocks())

describe('requireAgency guard', () => {
  it('anonymous -> agency login', async () => {
    mocked(auth).mockResolvedValue(null)
    expect(await redirectTarget()).toBe('/sk/login/agency')
  })

  it('employer-only member -> /employer', async () => {
    mocked(auth).mockResolvedValue({ user: { id: 'u1' } })
    mocked(prisma.userOrgRole.findMany).mockResolvedValue([{ orgId: 'o1', role: 'ORG_ADMIN' }])
    expect(await redirectTarget()).toBe('/sk/employer')
  })

  it('user without membership (candidate) -> /dashboard', async () => {
    mocked(auth).mockResolvedValue({ user: { id: 'u1' } })
    mocked(prisma.userOrgRole.findMany).mockResolvedValue([])
    expect(await redirectTarget()).toBe('/sk/dashboard')
  })

  it('agency member gets their agency org', async () => {
    mocked(auth).mockResolvedValue({ user: { id: 'u1' } })
    mocked(prisma.userOrgRole.findMany).mockResolvedValue([
      { orgId: 'o1', role: 'ORG_ADMIN' },
      { orgId: 'o2', role: 'AGENCY' },
    ])
    expect(await requireAgency('sk')).toEqual({ userId: 'u1', orgId: 'o2' })
  })

  it('prefers the active org when it is an agency org', async () => {
    mocked(auth).mockResolvedValue({ user: { id: 'u1', orgId: 'o3' } })
    mocked(prisma.userOrgRole.findMany).mockResolvedValue([
      { orgId: 'o2', role: 'AGENCY' },
      { orgId: 'o3', role: 'AGENCY' },
    ])
    expect(await requireAgency('sk')).toEqual({ userId: 'u1', orgId: 'o3' })
  })
})
