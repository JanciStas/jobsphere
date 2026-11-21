import { describe, it, expect, vi, beforeEach } from 'vitest'

// Wrappers are pass-through in the unit test (CSRF already bypasses in NODE_ENV=test).
vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: unknown) => h }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (h: unknown) => h }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

const tx = {
  gig: { updateMany: vi.fn() },
  gigProposal: { updateMany: vi.fn() },
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    gig: { findUnique: vi.fn() },
    userOrgRole: { findMany: vi.fn() },
    gigProposal: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { PATCH } from '../route'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const mocked = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>

const patch = (body: unknown, params: { id: string; proposalId: string }) =>
  PATCH(
    new Request('http://localhost/api/gigs/x/proposals/y', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params },
  )

function asMemberOfGigOrg() {
  mocked(auth).mockResolvedValue({ user: { id: 'u1' } })
  mocked(prisma.gig.findUnique).mockResolvedValue({ orgId: 'org-A' })
  mocked(prisma.userOrgRole.findMany).mockResolvedValue([{ orgId: 'org-A' }])
  mocked(prisma.gigProposal.findFirst).mockResolvedValue({ id: 'prop-1' })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked(prisma.$transaction).mockImplementation(async (cb: (t: typeof tx) => unknown) => cb(tx))
  tx.gig.updateMany.mockResolvedValue({ count: 1 })
  tx.gigProposal.updateMany.mockResolvedValue({ count: 1 })
})

describe('gig proposal PATCH — cross-gig IDOR guard', () => {
  it("404s and mutates nothing when the proposal is not in the caller's gig", async () => {
    asMemberOfGigOrg()
    // proposal belongs to a DIFFERENT gig → scoped lookup returns null
    mocked(prisma.gigProposal.findFirst).mockResolvedValue(null)

    const res = await patch({ action: 'REJECT' }, { id: 'gig-A', proposalId: 'prop-foreign' })

    expect(res.status).toBe(404)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a pending proposal that belongs to the gig', async () => {
    asMemberOfGigOrg()

    const res = await patch({ action: 'REJECT' }, { id: 'gig-A', proposalId: 'prop-1' })

    expect(res.status).toBe(200)
    expect(tx.gigProposal.updateMany).toHaveBeenCalledWith({
      where: { id: 'prop-1', gigId: 'gig-A', status: 'PENDING' },
      data: { status: 'REJECTED' },
    })
  })

  it('forbids a caller who is not a gig manager of the gig org (no proposal lookup)', async () => {
    mocked(auth).mockResolvedValue({ user: { id: 'u2' } })
    mocked(prisma.gig.findUnique).mockResolvedValue({ orgId: 'org-A' })
    mocked(prisma.userOrgRole.findMany).mockResolvedValue([{ orgId: 'org-B' }])

    const res = await patch({ action: 'ACCEPT' }, { id: 'gig-A', proposalId: 'prop-1' })

    expect(res.status).toBe(403)
    expect(prisma.gigProposal.findFirst).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('gig proposal PATCH — state machine', () => {
  it('accepts: gig OPEN → IN_PROGRESS, proposal PENDING → ACCEPTED, rest rejected', async () => {
    asMemberOfGigOrg()

    const res = await patch({ action: 'ACCEPT' }, { id: 'gig-A', proposalId: 'prop-1' })

    expect(res.status).toBe(200)
    expect(tx.gig.updateMany).toHaveBeenCalledWith({
      where: { id: 'gig-A', status: 'OPEN' },
      data: { status: 'IN_PROGRESS' },
    })
    expect(tx.gigProposal.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'prop-1', gigId: 'gig-A', status: 'PENDING' },
      data: { status: 'ACCEPTED' },
    })
    expect(tx.gigProposal.updateMany).toHaveBeenNthCalledWith(2, {
      where: { gigId: 'gig-A', id: { not: 'prop-1' }, status: 'PENDING' },
      data: { status: 'REJECTED' },
    })
  })

  it('409 when the proposal was already withdrawn or decided (and the gig change rolls back)', async () => {
    asMemberOfGigOrg()
    tx.gigProposal.updateMany.mockResolvedValueOnce({ count: 0 })

    const res = await patch({ action: 'ACCEPT' }, { id: 'gig-A', proposalId: 'prop-1' })

    expect(res.status).toBe(409)
    // Only the single conditional decision ran; the "reject the rest" step never did.
    expect(tx.gigProposal.updateMany).toHaveBeenCalledTimes(1)
  })

  it('409 when the gig is no longer OPEN (in progress or closed)', async () => {
    asMemberOfGigOrg()
    tx.gig.updateMany.mockResolvedValue({ count: 0 })

    const res = await patch({ action: 'ACCEPT' }, { id: 'gig-A', proposalId: 'prop-1' })

    expect(res.status).toBe(409)
    expect(tx.gigProposal.updateMany).not.toHaveBeenCalled()
  })
})
