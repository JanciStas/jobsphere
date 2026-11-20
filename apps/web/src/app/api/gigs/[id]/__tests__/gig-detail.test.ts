import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: unknown) => h }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (h: unknown) => h }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userOrgRole: { findMany: vi.fn() },
    gig: { findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  },
}))

import { GET, PATCH, DELETE } from '../route'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>
const ctx = { params: { id: 'gig-1' } }

const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/gigs/gig-1', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  vi.clearAllMocks()
  mocked(auth).mockResolvedValue({ user: { id: 'u1' } })
  mocked(prisma.userOrgRole.findMany).mockResolvedValue([{ orgId: 'org-A' }])
})

describe('GET /api/gigs/[id]', () => {
  it('401 anonymous', async () => {
    mocked(auth).mockResolvedValue(null)
    expect((await GET(req('GET'), ctx)).status).toBe(401)
  })
  it('404 for a foreign-org gig (query is scoped to caller orgs)', async () => {
    mocked(prisma.gig.findFirst).mockResolvedValue(null)
    const res = await GET(req('GET'), ctx)
    expect(res.status).toBe(404)
    expect(mocked(prisma.gig.findFirst).mock.calls[0][0].where).toEqual({
      id: 'gig-1',
      orgId: { in: ['org-A'] },
    })
  })
})

describe('PATCH /api/gigs/[id]', () => {
  it('401 anonymous', async () => {
    mocked(auth).mockResolvedValue(null)
    expect((await PATCH(req('PATCH', { status: 'CLOSED' }), ctx)).status).toBe(401)
  })

  it('404 (IDOR) and no write for a foreign-org gig', async () => {
    mocked(prisma.gig.updateMany).mockResolvedValue({ count: 0 })
    const res = await PATCH(req('PATCH', { status: 'CLOSED' }), ctx)
    expect(res.status).toBe(404)
    expect(mocked(prisma.gig.updateMany).mock.calls[0][0].where).toEqual({
      id: 'gig-1',
      orgId: { in: ['org-A'] },
    })
  })

  it('404 when the caller has no memberships at all', async () => {
    mocked(prisma.userOrgRole.findMany).mockResolvedValue([])
    const res = await PATCH(req('PATCH', { status: 'CLOSED' }), ctx)
    expect(res.status).toBe(404)
    expect(prisma.gig.updateMany).not.toHaveBeenCalled()
  })

  it('updates status for an own gig', async () => {
    mocked(prisma.gig.updateMany).mockResolvedValue({ count: 1 })
    const res = await PATCH(req('PATCH', { status: 'CLOSED' }), ctx)
    expect(res.status).toBe(200)
    expect(mocked(prisma.gig.updateMany).mock.calls[0][0].data).toEqual({ status: 'CLOSED' })
  })

  it('400 on an invalid status', async () => {
    const res = await PATCH(req('PATCH', { status: 'HACKED' }), ctx)
    expect(res.status).toBe(400)
    expect(prisma.gig.updateMany).not.toHaveBeenCalled()
  })

  it('400 when trying to change ownership fields', async () => {
    const res = await PATCH(req('PATCH', { orgId: 'org-B' }), ctx)
    expect(res.status).toBe(400)
    expect(prisma.gig.updateMany).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/gigs/[id]', () => {
  it('401 anonymous', async () => {
    mocked(auth).mockResolvedValue(null)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(401)
  })

  it('404 (IDOR) for a foreign-org gig', async () => {
    mocked(prisma.gig.deleteMany).mockResolvedValue({ count: 0 })
    const res = await DELETE(req('DELETE'), ctx)
    expect(res.status).toBe(404)
    expect(mocked(prisma.gig.deleteMany).mock.calls[0][0].where).toEqual({
      id: 'gig-1',
      orgId: { in: ['org-A'] },
    })
  })

  it('deletes an own gig', async () => {
    mocked(prisma.gig.deleteMany).mockResolvedValue({ count: 1 })
    const res = await DELETE(req('DELETE'), ctx)
    expect(res.status).toBe(200)
  })
})
