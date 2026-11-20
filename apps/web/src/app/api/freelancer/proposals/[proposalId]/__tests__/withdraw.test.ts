import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: unknown) => h }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (h: unknown) => h }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({
  prisma: { gigProposal: { findFirst: vi.fn(), updateMany: vi.fn() } },
}))

import { PATCH } from '../route'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const req = (body: unknown) =>
  new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) })
const ctx = { params: { proposalId: 'p1' } }

beforeEach(() => {
  vi.clearAllMocks()
  m(auth).mockResolvedValue({ user: { id: 'u1' } })
})

describe('freelancer proposal WITHDRAW', () => {
  it('401 anonymous', async () => {
    m(auth).mockResolvedValue(null)
    expect((await PATCH(req({ action: 'WITHDRAW' }), ctx)).status).toBe(401)
  })
  it('404 for a foreign proposal (IDOR) and scopes by userId', async () => {
    m(prisma.gigProposal.findFirst).mockResolvedValue(null)
    expect((await PATCH(req({ action: 'WITHDRAW' }), ctx)).status).toBe(404)
    expect(m(prisma.gigProposal.findFirst).mock.calls[0][0].where).toEqual({
      id: 'p1',
      freelancer: { userId: 'u1' },
    })
    expect(prisma.gigProposal.updateMany).not.toHaveBeenCalled()
  })
  it('409 when not pending', async () => {
    m(prisma.gigProposal.findFirst).mockResolvedValue({ id: 'p1', status: 'ACCEPTED' })
    expect((await PATCH(req({ action: 'WITHDRAW' }), ctx)).status).toBe(409)
  })
  it('withdraws a pending proposal', async () => {
    m(prisma.gigProposal.findFirst).mockResolvedValue({ id: 'p1', status: 'PENDING' })
    m(prisma.gigProposal.updateMany).mockResolvedValue({ count: 1 })
    expect((await PATCH(req({ action: 'WITHDRAW' }), ctx)).status).toBe(200)
  })
})
