/**
 * Admin gigs API: authz (401/403), validation, audit, one-ACCEPTED-per-gig rule.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({
  createAuditLog: vi.fn(),
  getRequestMetadata: () => ({ ipAddress: '127.0.0.1', userAgent: 'vitest' }),
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (handler: any) => handler }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (handler: any) => handler }))

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  auth,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    gig: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    gigProposal: { findFirst: vi.fn(), update: vi.fn() },
  },
}))

import { GET as listGET } from '../route'
import { GET as detailGET, PATCH as gigPATCH, DELETE as gigDELETE } from '../[id]/route'
import { PATCH as proposalPATCH } from '../[id]/proposals/[proposalId]/route'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit-log'

const p = prisma as any
const ctx = { params: { id: 'g1', proposalId: 'p1' } }
const json = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/gigs/g1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const GIG = {
  id: 'g1',
  orgId: 'o1',
  title: 'Logo',
  status: 'OPEN',
  budget: 100,
  currency: 'EUR',
  _count: { proposals: 2 },
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
})

describe('authz', () => {
  it('401 anonymous, 403 non-admin, no writes', async () => {
    auth.mockResolvedValue(null)
    expect((await listGET(new Request('http://x/api'))).status).toBe(401)
    expect((await gigDELETE(json('DELETE'), ctx)).status).toBe(401)

    auth.mockResolvedValue({ user: { id: 'u1', isGlobalAdmin: false } })
    expect((await listGET(new Request('http://x/api'))).status).toBe(403)
    expect((await detailGET(json('GET'), ctx)).status).toBe(403)
    expect((await gigPATCH(json('PATCH', { title: 'abc' }), ctx)).status).toBe(403)
    expect((await gigDELETE(json('DELETE'), ctx)).status).toBe(403)
    expect((await proposalPATCH(json('PATCH', { status: 'ACCEPTED' }), ctx)).status).toBe(403)
    expect(p.gig.update).not.toHaveBeenCalled()
    expect(p.gig.delete).not.toHaveBeenCalled()
    expect(p.gigProposal.update).not.toHaveBeenCalled()
    expect(createAuditLog).not.toHaveBeenCalled()
  })
})

describe('list filters', () => {
  it('applies status, org and agency filters', async () => {
    p.gig.findMany.mockResolvedValue([])
    p.gig.count.mockResolvedValue(0)
    await listGET(new Request('http://x/api?status=OPEN&orgId=o1&agency=1&search=logo'))
    const where = p.gig.findMany.mock.calls[0][0].where
    expect(where.status).toBe('OPEN')
    expect(where.orgId).toBe('o1')
    expect(where.organization.users.some.role).toBe('AGENCY')
    expect(where.OR).toBeDefined()
  })

  it('ignores an unknown status value', async () => {
    p.gig.findMany.mockResolvedValue([])
    p.gig.count.mockResolvedValue(0)
    await listGET(new Request('http://x/api?status=HACK'))
    expect(p.gig.findMany.mock.calls[0][0].where.status).toBeUndefined()
  })
})

describe('PATCH gig', () => {
  it('updates and audits before/after', async () => {
    p.gig.findUnique.mockResolvedValue(GIG)
    p.gig.update.mockResolvedValue({ ...GIG, status: 'CLOSED' })
    const res = await gigPATCH(json('PATCH', { status: 'CLOSED' }), ctx)
    expect(res.status).toBe(200)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'GIG',
        orgId: 'o1',
        previous: { status: 'OPEN' },
        metadata: { status: 'CLOSED' },
      }),
    )
  })

  it('validates input (status enum, unknown field, short title)', async () => {
    expect((await gigPATCH(json('PATCH', { status: 'DONE' }), ctx)).status).toBe(400)
    expect((await gigPATCH(json('PATCH', { orgId: 'o2' }), ctx)).status).toBe(400)
    expect((await gigPATCH(json('PATCH', { title: 'a' }), ctx)).status).toBe(400)
    expect(p.gig.update).not.toHaveBeenCalled()
  })
})

describe('DELETE gig', () => {
  it('deletes and keeps the pre-image in the audit log', async () => {
    p.gig.findUnique.mockResolvedValue(GIG)
    p.gig.delete.mockResolvedValue(GIG)
    expect((await gigDELETE(json('DELETE'), ctx)).status).toBe(200)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        resource: 'GIG',
        previous: expect.objectContaining({ title: 'Logo', proposals: 2 }),
      }),
    )
  })

  it('404 for a missing gig', async () => {
    p.gig.findUnique.mockResolvedValue(null)
    expect((await gigDELETE(json('DELETE'), ctx)).status).toBe(404)
    expect(p.gig.delete).not.toHaveBeenCalled()
  })
})

describe('PATCH proposal status', () => {
  const PROPOSAL = { id: 'p1', status: 'PENDING', gig: { orgId: 'o1' } }

  it('accepts when no other proposal is ACCEPTED', async () => {
    p.gigProposal.findFirst.mockResolvedValueOnce(PROPOSAL).mockResolvedValueOnce(null)
    p.gigProposal.update.mockResolvedValue({ id: 'p1', status: 'ACCEPTED' })
    expect((await proposalPATCH(json('PATCH', { status: 'ACCEPTED' }), ctx)).status).toBe(200)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        resource: 'GIG_PROPOSAL',
        previous: { gigId: 'g1', status: 'PENDING' },
      }),
    )
  })

  it('409 when another proposal is already ACCEPTED', async () => {
    p.gigProposal.findFirst.mockResolvedValueOnce(PROPOSAL).mockResolvedValueOnce({ id: 'p2' })
    expect((await proposalPATCH(json('PATCH', { status: 'ACCEPTED' }), ctx)).status).toBe(409)
    expect(p.gigProposal.update).not.toHaveBeenCalled()
  })

  it('rejecting does not run the ACCEPTED check', async () => {
    p.gigProposal.findFirst.mockResolvedValueOnce(PROPOSAL)
    p.gigProposal.update.mockResolvedValue({ id: 'p1', status: 'REJECTED' })
    expect((await proposalPATCH(json('PATCH', { status: 'REJECTED' }), ctx)).status).toBe(200)
    expect(p.gigProposal.findFirst).toHaveBeenCalledTimes(1)
  })

  it('404 for a proposal of another gig; 400 for a bad status', async () => {
    p.gigProposal.findFirst.mockResolvedValueOnce(null)
    expect((await proposalPATCH(json('PATCH', { status: 'REJECTED' }), ctx)).status).toBe(404)
    expect((await proposalPATCH(json('PATCH', { status: 'DONE' }), ctx)).status).toBe(400)
  })
})
