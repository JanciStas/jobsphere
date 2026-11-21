/**
 * Super-admin billing API: authZ (401/403), validation (reason, dates), the
 * Stripe-managed guard, deleted orgs, and the audit trail. Stripe is never called.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({
  createAuditLog: vi.fn(),
  getRequestMetadata: () => ({ ipAddress: '127.0.0.1', userAgent: 'vitest' }),
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: any) => h }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (h: any) => h }))

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  auth: authMock,
}))

const { db } = vi.hoisted(() => {
  const db: any = {
    organization: { findUnique: vi.fn() },
    subscription: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    entitlement: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
    plan: { findFirst: vi.fn() },
    product: { create: vi.fn() },
  }
  db.$transaction = (fn: any) => fn(db)
  return { db }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST as grant } from '../[orgId]/grant-plan/route'
import { POST as extend } from '../[orgId]/extend/route'
import { POST as cancel } from '../[orgId]/cancel/route'
import { POST as limits } from '../[orgId]/limits/route'
import { createAuditLog } from '@/lib/audit-log'
import {
  stripeDashboardUrl,
  estimateMrrCents,
  expireManualSubscriptions,
} from '@/lib/admin-billing'

const ctx = { params: { orgId: 'org-1' } }
const req = (body: unknown) =>
  new Request('http://localhost/api/admin/billing/org-1/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const future = (days: number) => new Date(Date.now() + days * 864e5).toISOString()
const REASON = 'Founder-approved pilot'

const manualSub = {
  id: 'sub-1',
  providerSubId: 'manual_abc',
  productId: 'p1',
  status: 'active',
  currentPeriodEnd: new Date(Date.now() + 10 * 864e5),
  cancelAt: null,
  metadata: { manual: true },
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
  db.organization.findUnique.mockResolvedValue({ id: 'org-1', name: 'Acme', deletedAt: null })
  db.subscription.findFirst.mockResolvedValue(null)
  db.subscription.create.mockResolvedValue({ id: 'sub-new' })
  db.subscription.update.mockResolvedValue({ id: 'sub-1' })
  db.plan.findFirst.mockResolvedValue({ productId: 'p-pro' })
  db.entitlement.findUnique.mockResolvedValue(null)
})

const endpoints: [string, (r: Request, c: any) => Promise<Response>, unknown][] = [
  ['grant-plan', grant, { plan: 'PROFESSIONAL', until: future(30), reason: REASON }],
  ['extend', extend, { until: future(60), reason: REASON }],
  ['cancel', cancel, { mode: 'immediate', reason: REASON }],
  ['limits', limits, { featureKey: 'MAX_JOBS', limit: 10, reason: REASON }],
]

describe.each(endpoints)('%s authZ', (_n, handler, body) => {
  it('401 when not signed in', async () => {
    authMock.mockResolvedValue(null)
    expect((await handler(req(body), ctx)).status).toBe(401)
    expect(createAuditLog).not.toHaveBeenCalled()
  })
  it('403 for a non-admin (even an ORG_ADMIN)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u', isGlobalAdmin: false } })
    expect((await handler(req(body), ctx)).status).toBe(403)
    expect(db.subscription.update).not.toHaveBeenCalled()
    expect(db.entitlement.upsert).not.toHaveBeenCalled()
  })
  it('400 without a reason', async () => {
    const { reason: _r, ...noReason } = body as any
    expect((await handler(req(noReason), ctx)).status).toBe(400)
  })
  it('409 for a deleted organization', async () => {
    db.organization.findUnique.mockResolvedValue({ id: 'org-1', name: 'x', deletedAt: new Date() })
    expect((await handler(req(body), ctx)).status).toBe(409)
    expect(createAuditLog).not.toHaveBeenCalled()
  })
  it('404 for an unknown organization', async () => {
    db.organization.findUnique.mockResolvedValue(null)
    expect((await handler(req(body), ctx)).status).toBe(404)
  })
})

describe('grant-plan', () => {
  it('rejects a past date', async () => {
    const res = await grant(req({ plan: 'PROFESSIONAL', until: '2020-01-01', reason: REASON }), ctx)
    expect(res.status).toBe(400)
  })
  it('rejects STARTER as a grant target', async () => {
    const res = await grant(req({ plan: 'STARTER', until: future(5), reason: REASON }), ctx)
    expect(res.status).toBe(400)
  })
  it('creates a manual_ subscription, applies limits and audits with reason', async () => {
    const res = await grant(req({ plan: 'PROFESSIONAL', until: future(30), reason: REASON }), ctx)
    expect(res.status).toBe(200)
    const data = db.subscription.create.mock.calls[0][0].data
    expect(data.providerSubId.startsWith('manual_')).toBe(true)
    expect(data.metadata).toMatchObject({ manual: true, planKey: 'PROFESSIONAL' })
    expect(db.entitlement.upsert).toHaveBeenCalled()
    const audit = (createAuditLog as any).mock.calls[0][0]
    expect(audit).toMatchObject({ userId: 'admin-1', orgId: 'org-1', resource: 'SUBSCRIPTION' })
    expect(audit.metadata.reason).toBe(REASON)
  })
  it('refuses to overwrite a Stripe-managed subscription', async () => {
    db.subscription.findFirst.mockResolvedValue({ ...manualSub, providerSubId: 'sub_123' })
    const res = await grant(req({ plan: 'ENTERPRISE', until: future(30), reason: REASON }), ctx)
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('STRIPE_MANAGED')
    expect(db.subscription.update).not.toHaveBeenCalled()
  })
  it('updates an existing manual subscription instead of creating a second one', async () => {
    db.subscription.findFirst.mockResolvedValue(manualSub)
    const res = await grant(req({ plan: 'ENTERPRISE', until: future(30), reason: REASON }), ctx)
    expect(res.status).toBe(200)
    expect(db.subscription.create).not.toHaveBeenCalled()
    expect(db.subscription.update).toHaveBeenCalled()
  })
})

describe('extend / cancel', () => {
  it('extend needs a later date than the current period end', async () => {
    db.subscription.findFirst.mockResolvedValue(manualSub)
    const res = await extend(req({ until: future(3), reason: REASON }), ctx)
    expect(res.status).toBe(400)
  })
  it('extend moves currentPeriodEnd and audits the previous value', async () => {
    db.subscription.findFirst.mockResolvedValue(manualSub)
    const res = await extend(req({ until: future(90), reason: REASON }), ctx)
    expect(res.status).toBe(200)
    expect((createAuditLog as any).mock.calls[0][0].previous.currentPeriodEnd).toBeTruthy()
  })
  it('extend/cancel on Stripe subscription is blocked', async () => {
    db.subscription.findFirst.mockResolvedValue({ ...manualSub, providerSubId: 'sub_9' })
    expect((await extend(req({ until: future(90), reason: REASON }), ctx)).status).toBe(409)
    expect((await cancel(req({ mode: 'immediate', reason: REASON }), ctx)).status).toBe(409)
  })
  it('409 when there is no active subscription', async () => {
    expect((await cancel(req({ mode: 'period_end', reason: REASON }), ctx)).status).toBe(409)
  })
  it('period_end sets cancelAt, immediate cancels and reverts to STARTER limits', async () => {
    db.subscription.findFirst.mockResolvedValue(manualSub)
    await cancel(req({ mode: 'period_end', reason: REASON }), ctx)
    expect(db.subscription.update.mock.calls[0][0].data.cancelAt).toEqual(
      manualSub.currentPeriodEnd,
    )
    db.subscription.update.mockClear()
    await cancel(req({ mode: 'immediate', reason: REASON }), ctx)
    expect(db.subscription.update.mock.calls[0][0].data.status).toBe('canceled')
    const jobs = db.entitlement.upsert.mock.calls
      .map((c: any) => c[0])
      .find((u: any) => u.create.featureKey === 'MAX_JOBS')
    expect(jobs.update.limitInt).toBe(5)
    // Overrides outside the plan table are reset too (they used to survive a cancel).
    const resetKeys = db.entitlement.updateMany.mock.calls.map((c: any) => c[0].where.featureKey)
    expect(resetKeys).toEqual(expect.arrayContaining(['CUSTOM_BRANDING', 'API_ACCESS']))
    for (const c of db.entitlement.updateMany.mock.calls) expect(c[0].data.limitInt).toBe(0)
  })
  it('only treats subscriptions within the grace window as live (same rule as getCurrentPlan)', async () => {
    await extend(req({ until: future(60), reason: REASON }), ctx)
    const where = db.subscription.findFirst.mock.calls[0][0].where
    expect(where.status).toEqual({ in: ['active', 'trialing'] })
    expect(where.currentPeriodEnd.gt).toBeInstanceOf(Date)
    expect(where.currentPeriodEnd.gt.getTime()).toBeLessThan(Date.now())
  })
})

describe('expireManualSubscriptions (daily cron)', () => {
  const now = new Date('2027-01-10T03:30:00Z')
  const expiredSub = {
    id: 'sub-old',
    orgId: 'org-1',
    status: 'active',
    currentPeriodEnd: new Date('2027-01-01T00:00:00Z'),
    cancelAt: null,
  }

  it('selects only manual, still-active rows past the grace window or past cancelAt', async () => {
    db.subscription.findMany.mockResolvedValue([])
    await expireManualSubscriptions(now)
    const where = db.subscription.findMany.mock.calls[0][0].where
    expect(where.providerSubId).toEqual({ startsWith: 'manual_' })
    expect(where.status).toEqual({ in: ['active', 'trialing'] })
    const [periodCond, cancelCond] = where.OR
    expect(periodCond.currentPeriodEnd.lte.getTime()).toBe(now.getTime() - 3 * 864e5)
    expect(cancelCond.cancelAt.lte).toEqual(now)
  })

  it('cancels the row, resets the org to STARTER and audits as the system', async () => {
    db.subscription.findMany.mockResolvedValue([expiredSub])
    db.subscription.findFirst.mockResolvedValue(null) // no other live subscription
    const result = await expireManualSubscriptions(now)

    expect(result).toEqual({ expired: 1, failed: 0 })
    const upd = db.subscription.update.mock.calls[0][0]
    expect(upd.where).toEqual({ id: 'sub-old' })
    expect(upd.data).toMatchObject({ status: 'canceled', endedAt: now })
    const jobs = db.entitlement.upsert.mock.calls
      .map((c: any) => c[0])
      .find((u: any) => u.create.featureKey === 'MAX_JOBS')
    expect(jobs.update.limitInt).toBe(5)
    const audit = (createAuditLog as any).mock.calls[0][0]
    expect(audit.userId).toBeUndefined()
    expect(audit.metadata).toMatchObject({
      op: 'admin_billing.manual_expiry',
      reason: 'period_ended',
      limitsResetToStarter: true,
    })
  })

  it('keeps the limits when another live subscription (e.g. Stripe) still covers the org', async () => {
    db.subscription.findMany.mockResolvedValue([
      { ...expiredSub, cancelAt: new Date('2027-01-05T00:00:00Z') },
    ])
    db.subscription.findFirst.mockResolvedValue({ id: 'sub-stripe' })
    await expireManualSubscriptions(now)
    expect(db.subscription.update.mock.calls[0][0].data.canceledAt).toEqual(
      new Date('2027-01-05T00:00:00Z'),
    )
    expect(db.entitlement.upsert).not.toHaveBeenCalled()
    expect((createAuditLog as any).mock.calls[0][0].metadata).toMatchObject({
      reason: 'cancel_at_reached',
      limitsResetToStarter: false,
    })
  })

  it('counts a failing org and continues with the next one', async () => {
    db.subscription.findMany.mockResolvedValue([expiredSub, { ...expiredSub, id: 'sub-2' }])
    db.subscription.findFirst.mockResolvedValue(null)
    db.subscription.update.mockRejectedValueOnce(new Error('db down'))
    const result = await expireManualSubscriptions(now)
    expect(result).toEqual({ expired: 1, failed: 1 })
  })
})

describe('limits', () => {
  it('rejects unknown feature keys and negative limits', async () => {
    expect((await limits(req({ featureKey: 'HACK', limit: 1, reason: REASON }), ctx)).status).toBe(
      400,
    )
    expect(
      (await limits(req({ featureKey: 'MAX_JOBS', limit: -1, reason: REASON }), ctx)).status,
    ).toBe(400)
  })
  it('null means unlimited and the audit records previous + new', async () => {
    const res = await limits(req({ featureKey: 'MAX_JOBS', limit: null, reason: REASON }), ctx)
    expect(res.status).toBe(200)
    expect(db.entitlement.upsert.mock.calls[0][0].update.limitInt).toBeNull()
    const audit = (createAuditLog as any).mock.calls[0][0]
    expect(audit.previous).toMatchObject({ featureKey: 'MAX_JOBS', limit: 5 })
    expect(audit.metadata).toMatchObject({ limit: null, reason: REASON })
  })
})

describe('helpers', () => {
  it('stripeDashboardUrl only for real sub_ ids', () => {
    expect(stripeDashboardUrl('sub_1Abc')).toBe(
      'https://dashboard.stripe.com/subscriptions/sub_1Abc',
    )
    expect(stripeDashboardUrl('manual_x')).toBeNull()
    expect(stripeDashboardUrl('sub_1/../x')).toBeNull()
  })
  it('MRR ignores manual grants and normalises yearly prices', () => {
    const price = (amount: number, interval: string) => [
      { currency: 'EUR', amount, interval, intervalCount: 1 },
    ]
    expect(
      estimateMrrCents([
        { providerSubId: 'sub_a', product: { prices: price(1200, 'YEAR') } },
        { providerSubId: 'sub_b', product: { prices: price(5000, 'MONTH') } },
        { providerSubId: 'manual_c', product: { prices: price(9900, 'MONTH') } },
      ]),
    ).toBe(100 + 5000)
  })
})
