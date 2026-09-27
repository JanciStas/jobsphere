/**
 * Stripe billing portal — authorisation.
 *
 * A portal session is a bearer of authority: whoever opens the returned URL can
 * change or cancel the subscription behind it. So the two things worth pinning
 * are that the caller must be an ORG_ADMIN, and that no session is ever created
 * for a customer the caller does not belong to.
 *
 * The tests assert Stripe was never called on every refusal path. Checking only
 * the status code would pass even if the portal session were created first and
 * the 403 returned afterwards — by which point the URL exists.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (handler: any) => handler }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (handler: any) => handler }))

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth }))

const { createPortalSession } = vi.hoisted(() => ({ createPortalSession: vi.fn() }))
vi.mock('stripe', () => ({
  default: class {
    billingPortal = { sessions: { create: createPortalSession } }
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userOrgRole: { findFirst: vi.fn() },
    orgCustomer: { findUnique: vi.fn() },
  },
}))

import { POST } from '../portal/route'
import { prisma } from '@/lib/prisma'

const req = () => new Request('http://localhost:3000/api/stripe/portal', { method: 'POST' })

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: 'user-1' } })
  ;(prisma.userOrgRole.findFirst as any).mockResolvedValue({
    userId: 'user-1',
    orgId: 'org-1',
    role: 'ORG_ADMIN',
  })
  ;(prisma.orgCustomer.findUnique as any).mockResolvedValue({
    orgId: 'org-1',
    providerCustomerId: 'cus_123',
  })
  createPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/session/abc' })
})

describe('who may open the billing portal', () => {
  it('refuses an anonymous caller', async () => {
    auth.mockResolvedValue(null)
    const res = await POST(req())
    expect(res.status).toBe(401)
    expect(createPortalSession).not.toHaveBeenCalled()
  })

  it('refuses a caller who belongs to no organisation', async () => {
    ;(prisma.userOrgRole.findFirst as any).mockResolvedValue(null)
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect(createPortalSession).not.toHaveBeenCalled()
  })

  it.each(['RECRUITER', 'HIRING_MANAGER', 'AGENCY'])(
    'refuses a %s and creates no portal session',
    async (role) => {
      ;(prisma.userOrgRole.findFirst as any).mockResolvedValue({ orgId: 'org-1', role })
      const res = await POST(req())
      expect(res.status).toBe(403)
      // The important half: a 403 after the session exists is not a refusal.
      expect(createPortalSession).not.toHaveBeenCalled()
    },
  )

  it('allows an ORG_ADMIN', async () => {
    const res = await POST(req())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ url: 'https://billing.stripe.com/session/abc' })
  })
})

describe('which customer the session is opened for', () => {
  it('looks the customer up by the caller own organisation', async () => {
    await POST(req())
    expect(prisma.orgCustomer.findUnique).toHaveBeenCalledWith({ where: { orgId: 'org-1' } })
    expect(createPortalSession).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_123' }),
    )
  })

  it('refuses when the organisation has no Stripe customer yet', async () => {
    ;(prisma.orgCustomer.findUnique as any).mockResolvedValue(null)
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect(createPortalSession).not.toHaveBeenCalled()
  })

  it('refuses when the customer record exists but carries no provider id', async () => {
    ;(prisma.orgCustomer.findUnique as any).mockResolvedValue({ orgId: 'org-1' })
    const res = await POST(req())
    expect(res.status).toBe(400)
    expect(createPortalSession).not.toHaveBeenCalled()
  })
})

describe('failure handling', () => {
  it('does not leak the Stripe error to the caller', async () => {
    createPortalSession.mockRejectedValue(new Error('No such customer: cus_123 (sk_live_...)'))
    const res = await POST(req())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Failed to create portal session')
    expect(JSON.stringify(body)).not.toContain('sk_live')
  })
})

describe('multi-organisation membership', () => {
  // Without a session activeOrgId the lookup is deterministic: the caller's oldest
  // LIVE membership (removed members never resolve). With an activeOrgId that org
  // wins — see tests/security/tenant-isolation-regressions.test.ts.
  it('falls back to the oldest live membership when no active org is set', async () => {
    await POST(req())
    expect(prisma.userOrgRole.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })
  })

  it('refuses if that first membership is not an ORG_ADMIN, even when another is', async () => {
    // A user who is RECRUITER in org A and ORG_ADMIN in org B can be refused
    // outright, depending only on row order.
    ;(prisma.userOrgRole.findFirst as any).mockResolvedValue({ orgId: 'org-a', role: 'RECRUITER' })
    const res = await POST(req())
    expect(res.status).toBe(403)
  })
})
