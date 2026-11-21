import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: unknown) => h }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (h: unknown) => h }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    freelancerProfile: { findUnique: vi.fn() },
    gig: { findFirst: vi.fn() },
    gigProposal: { findUnique: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  },
}))

import { POST } from '../route'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>

const submit = () =>
  POST(
    new Request('http://localhost/api/gigs/g1/proposals', {
      method: 'POST',
      body: JSON.stringify({ message: 'Rád to spravím', proposedRate: 400 }),
      headers: { 'content-type': 'application/json' },
    }),
    { params: { id: 'g1' } },
  )

beforeEach(() => {
  vi.clearAllMocks()
  mocked(auth).mockResolvedValue({ user: { id: 'u1' } })
  mocked(prisma.freelancerProfile.findUnique).mockResolvedValue({ id: 'f1' })
  mocked(prisma.gig.findFirst).mockResolvedValue({ status: 'OPEN' })
})

describe('POST /api/gigs/[id]/proposals', () => {
  it('creates a first proposal', async () => {
    mocked(prisma.gigProposal.findUnique).mockResolvedValue(null)
    mocked(prisma.gigProposal.create).mockResolvedValue({ id: 'p1' })
    const res = await submit()
    expect(res.status).toBe(201)
    expect(mocked(prisma.gigProposal.create).mock.calls[0][0].data.freelancerId).toBe('f1')
  })

  it('409 and no change when re-submitting an already decided proposal', async () => {
    mocked(prisma.gigProposal.findUnique).mockResolvedValue({ id: 'p1' })
    mocked(prisma.gigProposal.updateMany).mockResolvedValue({ count: 0 })
    const res = await submit()
    expect(res.status).toBe(409)
    expect(mocked(prisma.gigProposal.updateMany).mock.calls[0][0].where).toEqual({
      id: 'p1',
      status: { in: ['PENDING', 'WITHDRAWN'] },
    })
    expect(prisma.gigProposal.create).not.toHaveBeenCalled()
  })

  it('ignores gigs of suspended organizations', async () => {
    mocked(prisma.gig.findFirst).mockResolvedValue(null)
    const res = await submit()
    expect(res.status).toBe(404)
    expect(mocked(prisma.gig.findFirst).mock.calls[0][0].where).toEqual({
      id: 'g1',
      organization: { deletedAt: null },
    })
  })
})
