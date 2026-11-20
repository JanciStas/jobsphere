/**
 * Admin freelancers API: authz (401/403), validation, audit trail, portfolio
 * moderation incl. the "PortfolioItem table missing" -> 503 path.
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
    freelancerProfile: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    gigProposal: { findMany: vi.fn() },
    portfolioItem: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { GET as listGET } from '../route'
import { GET as detailGET, PATCH as profilePATCH } from '../[id]/route'
import { PATCH as itemPATCH, DELETE as itemDELETE } from '../[id]/portfolio/[itemId]/route'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit-log'

const p = prisma as any
const ctx = { params: { id: 'f1', itemId: 'i1' } }
const json = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/freelancers/f1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
})

describe('authz', () => {
  it('401 when not signed in, 403 for a non-admin, nothing written', async () => {
    auth.mockResolvedValue(null)
    expect((await listGET(new Request('http://x/api'))).status).toBe(401)
    expect((await profilePATCH(json('PATCH', { visible: false }), ctx)).status).toBe(401)

    auth.mockResolvedValue({ user: { id: 'u1', isGlobalAdmin: false } })
    expect((await listGET(new Request('http://x/api'))).status).toBe(403)
    expect((await detailGET(json('GET'), ctx)).status).toBe(403)
    expect((await profilePATCH(json('PATCH', { visible: false }), ctx)).status).toBe(403)
    expect((await itemPATCH(json('PATCH', { title: 'x' }), ctx)).status).toBe(403)
    expect((await itemDELETE(json('DELETE'), ctx)).status).toBe(403)
    expect(p.freelancerProfile.update).not.toHaveBeenCalled()
    expect(p.portfolioItem.delete).not.toHaveBeenCalled()
    expect(createAuditLog).not.toHaveBeenCalled()
  })
})

describe('list', () => {
  it('returns paged items for an admin', async () => {
    p.freelancerProfile.findMany.mockResolvedValue([{ id: 'f1' }])
    p.freelancerProfile.count.mockResolvedValue(1)
    const res = await listGET(new Request('http://x/api?search=logo&visible=true&page=2'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ total: 1, page: 2 })
    expect(p.freelancerProfile.findMany.mock.calls[0][0].where.visible).toBe(true)
    expect(p.freelancerProfile.findMany.mock.calls[0][0].skip).toBe(25)
  })
})

describe('PATCH profile', () => {
  const BEFORE = { id: 'f1', visible: true, title: 'Grafik' }

  it('hides a profile and audits before/after', async () => {
    p.freelancerProfile.findUnique.mockResolvedValue(BEFORE)
    p.freelancerProfile.update.mockResolvedValue({ ...BEFORE, visible: false })
    const res = await profilePATCH(json('PATCH', { visible: false }), ctx)
    expect(res.status).toBe(200)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        resource: 'FREELANCER',
        resourceId: 'f1',
        previous: { visible: true },
        metadata: { visible: false },
      }),
    )
  })

  it('rejects unknown fields, bad URL and empty body', async () => {
    expect((await profilePATCH(json('PATCH', { userId: 'evil' }), ctx)).status).toBe(400)
    expect(
      (await profilePATCH(json('PATCH', { portfolioUrl: 'javascript:alert(1)' }), ctx)).status,
    ).toBe(400)
    expect((await profilePATCH(json('PATCH', {}), ctx)).status).toBe(400)
    expect(p.freelancerProfile.update).not.toHaveBeenCalled()
  })

  it('404 for a missing profile', async () => {
    p.freelancerProfile.findUnique.mockResolvedValue(null)
    expect((await profilePATCH(json('PATCH', { visible: true }), ctx)).status).toBe(404)
  })
})

describe('portfolio moderation', () => {
  const ITEM = { id: 'i1', title: 'Logo', description: null, url: null }

  it('scopes the lookup to the freelancer (item of another profile = 404)', async () => {
    p.portfolioItem.findFirst.mockResolvedValue(null)
    expect((await itemDELETE(json('DELETE'), ctx)).status).toBe(404)
    expect(p.portfolioItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'i1', freelancerId: 'f1' } }),
    )
    expect(p.portfolioItem.delete).not.toHaveBeenCalled()
  })

  it('deletes and audits', async () => {
    p.portfolioItem.findFirst.mockResolvedValue(ITEM)
    p.portfolioItem.delete.mockResolvedValue(ITEM)
    expect((await itemDELETE(json('DELETE'), ctx)).status).toBe(200)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', resource: 'PORTFOLIO_ITEM' }),
    )
  })

  it('edits title and audits', async () => {
    p.portfolioItem.findFirst.mockResolvedValue(ITEM)
    p.portfolioItem.update.mockResolvedValue({ ...ITEM, title: 'Nové' })
    expect((await itemPATCH(json('PATCH', { title: 'Nové' }), ctx)).status).toBe(200)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', resource: 'PORTFOLIO_ITEM' }),
    )
  })

  it('503 when the PortfolioItem table does not exist', async () => {
    p.portfolioItem.findFirst.mockRejectedValue({ code: 'P2021' })
    expect((await itemDELETE(json('DELETE'), ctx)).status).toBe(503)
    expect((await itemPATCH(json('PATCH', { title: 'x' }), ctx)).status).toBe(503)
  })

  it('detail degrades to an empty portfolio when the table is missing', async () => {
    p.freelancerProfile.findUnique.mockResolvedValue({ id: 'f1' })
    p.portfolioItem.findMany.mockRejectedValue({ code: 'P2021' })
    p.gigProposal.findMany.mockResolvedValue([])
    const res = await detailGET(json('GET'), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).portfolio).toEqual([])
  })
})
