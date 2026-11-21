import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: unknown) => h }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (h: unknown) => h }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    userOrgRole: { findMany: vi.fn() },
    gig: { create: vi.fn(), findMany: vi.fn() },
  },
}))

import { POST } from '../route'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/gigs', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  )

beforeEach(() => vi.clearAllMocks())

describe('POST /api/gigs', () => {
  it('401 for anonymous', async () => {
    mocked(auth).mockResolvedValue(null)
    const res = await post({ title: 'x', description: 'y' })
    expect(res.status).toBe(401)
    expect(prisma.gig.create).not.toHaveBeenCalled()
  })

  it('403 for a user without any organization membership', async () => {
    mocked(auth).mockResolvedValue({ user: { id: 'u1' } })
    mocked(prisma.userOrgRole.findMany).mockResolvedValue([])
    const res = await post({ title: 'x', description: 'y' })
    expect(res.status).toBe(403)
    expect(prisma.gig.create).not.toHaveBeenCalled()
  })

  it('lets an AGENCY member create a gig scoped to their own org', async () => {
    mocked(auth).mockResolvedValue({ user: { id: 'agency-user' } })
    mocked(prisma.userOrgRole.findMany).mockResolvedValue([{ orgId: 'org-agency', role: 'AGENCY' }])
    mocked(prisma.gig.create).mockResolvedValue({ id: 'g1' })
    const res = await post({
      title: 'Web redesign',
      description: 'Potrebujeme redizajn',
      budget: 2000,
      durationDays: 30,
      // a spoofed orgId in the body must be ignored
      orgId: 'org-victim',
    })
    expect(res.status).toBe(201)
    const data = mocked(prisma.gig.create).mock.calls[0][0].data
    expect(data.orgId).toBe('org-agency')
    expect(data.createdBy).toBe('agency-user')
    expect(data.currency).toBe('EUR')
  })

  it('400 on invalid payload (Zod)', async () => {
    mocked(auth).mockResolvedValue({ user: { id: 'u1' } })
    mocked(prisma.userOrgRole.findMany).mockResolvedValue([{ orgId: 'o', role: 'AGENCY' }])
    const res = await post({ title: '', description: 'y' })
    expect(res.status).toBe(400)
    expect(prisma.gig.create).not.toHaveBeenCalled()
  })

  it('files the gig under the agency org for a user who is also a recruiter elsewhere', async () => {
    mocked(auth).mockResolvedValue({ user: { id: 'u1', orgId: 'org-recruiter' } })
    mocked(prisma.userOrgRole.findMany).mockResolvedValue([
      { orgId: 'org-recruiter', role: 'RECRUITER' },
      { orgId: 'org-agency', role: 'AGENCY' },
    ])
    mocked(prisma.gig.create).mockResolvedValue({ id: 'g2' })
    const res = await post({ title: 'Logo', description: 'Nové logo' })
    expect(res.status).toBe(201)
    expect(mocked(prisma.gig.create).mock.calls[0][0].data.orgId).toBe('org-agency')
  })

  it('only counts gig-managing roles in non-suspended orgs', async () => {
    mocked(auth).mockResolvedValue({ user: { id: 'u1' } })
    mocked(prisma.userOrgRole.findMany).mockResolvedValue([])
    await post({ title: 'x', description: 'y' })
    const where = mocked(prisma.userOrgRole.findMany).mock.calls[0][0].where
    expect(where.role).toEqual({ in: ['AGENCY', 'ORG_ADMIN', 'RECRUITER'] })
    expect(where.organization).toEqual({ deletedAt: null })
  })
})
