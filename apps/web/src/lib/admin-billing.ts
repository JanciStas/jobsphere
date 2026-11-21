/**
 * Super-admin billing helpers.
 *
 * Founders can help a company with its plan WITHOUT Stripe (production has no
 * Stripe keys, finding H4). Everything here only touches our own DB and never
 * calls the Stripe API. A manual subscription is a normal `Subscription` row
 * whose `providerSubId` starts with `manual_` and whose metadata carries
 * `manual: true`, so getCurrentPlan() and the entitlement checks see it.
 *
 * Subscriptions that belong to Stripe (providerSubId not `manual_*`) are NOT
 * mutated here: the next webhook would overwrite the change. For those the UI
 * links to the Stripe dashboard instead.
 */

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { handleApiError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import {
  STARTER_LIMITS,
  liveSubscriptionWhere,
  PLAN_EXPIRY_GRACE_MS,
  type Feature,
} from '@/lib/entitlements'

export const MANUAL_PREFIX = 'manual_'
export const MAX_MANUAL_YEARS = 5

export const GRANTABLE_PLANS = ['PROFESSIONAL', 'ENTERPRISE'] as const
export type GrantablePlan = (typeof GRANTABLE_PLANS)[number]

export const FEATURES: Feature[] = [
  'MAX_JOBS',
  'MAX_CANDIDATES',
  'MAX_TEAM_MEMBERS',
  'EMAIL_SEQUENCES',
  'ASSESSMENTS',
  'AI_MATCHING',
  'CUSTOM_BRANDING',
  'API_ACCESS',
]

/** null = unlimited. Mirrors the Stripe webhook's table (+ team members). */
export const PLAN_LIMITS: Record<
  'STARTER' | GrantablePlan,
  Partial<Record<Feature, number | null>>
> = {
  STARTER: {
    MAX_JOBS: 5,
    MAX_CANDIDATES: 50,
    MAX_TEAM_MEMBERS: 2,
    EMAIL_SEQUENCES: 0,
    ASSESSMENTS: 0,
    AI_MATCHING: 0,
  },
  PROFESSIONAL: {
    MAX_JOBS: 50,
    MAX_CANDIDATES: 500,
    MAX_TEAM_MEMBERS: 10,
    EMAIL_SEQUENCES: 1,
    ASSESSMENTS: 1,
    AI_MATCHING: 1,
  },
  ENTERPRISE: {
    MAX_JOBS: null,
    MAX_CANDIDATES: null,
    MAX_TEAM_MEMBERS: null,
    EMAIL_SEQUENCES: 1,
    ASSESSMENTS: 1,
    AI_MATCHING: 1,
  },
}

export class BillingError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? code)
  }
}

// ---------------------------------------------------------------- schemas ---

export const reasonSchema = z.string().trim().min(5).max(500)

/** A calendar date strictly in the future and at most MAX_MANUAL_YEARS ahead. */
const futureDate = z.coerce.date().superRefine((d, ctx) => {
  const now = Date.now()
  if (Number.isNaN(d.getTime()) || d.getTime() <= now) {
    ctx.addIssue({ code: 'custom', message: 'DATE_IN_PAST' })
  } else if (d.getTime() > now + MAX_MANUAL_YEARS * 366 * 24 * 3600 * 1000) {
    ctx.addIssue({ code: 'custom', message: 'DATE_TOO_FAR' })
  }
})

export const grantPlanSchema = z.object({
  plan: z.enum(GRANTABLE_PLANS),
  until: futureDate,
  reason: reasonSchema,
})

export const extendSchema = z.object({ until: futureDate, reason: reasonSchema })

export const cancelSchema = z.object({
  mode: z.enum(['period_end', 'immediate']),
  reason: reasonSchema,
})

export const limitSchema = z.object({
  featureKey: z.enum(FEATURES as [Feature, ...Feature[]]),
  /** null = unlimited, 0 = disabled. */
  limit: z.number().int().min(0).max(1_000_000).nullable(),
  reason: reasonSchema,
})

// -------------------------------------------------------------- utilities ---

export function isManualSubscription(providerSubId: string): boolean {
  return providerSubId.startsWith(MANUAL_PREFIX)
}

/** URL pattern only — no API call. Returns null for manual / malformed ids. */
export function stripeDashboardUrl(providerSubId: string): string | null {
  if (!/^sub_[A-Za-z0-9]+$/.test(providerSubId)) return null
  return `https://dashboard.stripe.com/subscriptions/${providerSubId}`
}

/** Monthly amount in cents for one Price row (EUR only; others ignored). */
export function monthlyCents(price: {
  currency: string
  amount: number
  interval: string
  intervalCount: number
}): number {
  if (price.currency.toUpperCase() !== 'EUR') return 0
  const months = (price.interval === 'YEAR' ? 12 : 1) * Math.max(1, price.intervalCount)
  return Math.round(price.amount / months)
}

/** Estimated MRR (cents, EUR) of Stripe-backed active subscriptions. Manual grants excluded. */
export function estimateMrrCents(
  subs: {
    providerSubId: string
    product: {
      prices: { currency: string; amount: number; interval: string; intervalCount: number }[]
    }
  }[],
): number {
  let total = 0
  for (const s of subs) {
    if (isManualSubscription(s.providerSubId)) continue
    const eur = s.product.prices.map(monthlyCents).filter((c) => c > 0)
    if (eur.length) total += Math.min(...eur) // cheapest active price = conservative
  }
  return total
}

// ------------------------------------------------------------- API guards ---

type GuardOk = { userId: string }

/** 401 unauthenticated, 403 non-admin. Server-side, per request. */
export async function guardAdmin(): Promise<GuardOk | NextResponse> {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!session.user.isGlobalAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return { userId: session.user.id }
}

export function orgIdFrom(context?: { params?: Record<string, string> }): string | null {
  const id = context?.params?.orgId
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
}

/**
 * Shared POST pipeline: admin check -> org id -> JSON + Zod -> action -> JSON.
 * The action writes its own audit entry (it knows before/after).
 */
export async function runBillingAction<S extends z.ZodTypeAny>(
  req: Request,
  context: { params?: Record<string, string> } | undefined,
  schema: S,
  action: (ctx: {
    orgId: string
    userId: string
    body: z.infer<S>
    meta: { ipAddress?: string; userAgent?: string }
  }) => Promise<Record<string, unknown>>,
): Promise<Response> {
  try {
    const guard = await guardAdmin()
    if (guard instanceof NextResponse) return guard

    const orgId = orgIdFrom(context)
    if (!orgId) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const result = await action({
      orgId,
      userId: guard.userId,
      body: parsed.data,
      meta: getRequestMetadata(req),
    })
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    return handleApiError(error)
  }
}

async function requireLiveOrg(orgId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, deletedAt: true },
  })
  if (!org) throw new BillingError('ORG_NOT_FOUND', 404, 'Organization not found')
  if (org.deletedAt) throw new BillingError('ORG_DELETED', 409, 'Organization is deleted')
  return org
}

/**
 * Same selection rule as getCurrentPlan() (shared `liveSubscriptionWhere`): the newest
 * active/trialing subscription whose period has not lapsed past the grace window. A stale
 * Stripe row whose webhook never arrived (no Stripe keys in production, H4) therefore no
 * longer blocks a manual grant, and an expired manual grant can no longer be extended.
 */
async function findLiveSubscription(
  orgId: string,
  db: Pick<typeof prisma, 'subscription'> = prisma,
) {
  return db.subscription.findFirst({
    where: { orgId, ...liveSubscriptionWhere() },
    orderBy: { currentPeriodEnd: 'desc' },
  })
}

function assertManual(sub: { providerSubId: string }) {
  if (!isManualSubscription(sub.providerSubId)) {
    throw new BillingError(
      'STRIPE_MANAGED',
      409,
      'Subscription is managed by Stripe; change it in the Stripe dashboard',
    )
  }
}

async function applyPlanLimits(tx: typeof prisma, orgId: string, plan: 'STARTER' | GrantablePlan) {
  for (const [featureKey, limit] of Object.entries(PLAN_LIMITS[plan])) {
    const limitInt = limit ?? null
    await tx.entitlement.upsert({
      where: { orgId_featureKey: { orgId, featureKey } },
      create: { orgId, featureKey, limitInt, remainingInt: limitInt },
      update: { limitInt, remainingInt: limitInt, deletedAt: null },
    })
  }
}

/**
 * Back to STARTER when a plan ends: the plan table AND every per-feature override an admin
 * set (CUSTOM_BRANDING / API_ACCESS are not in any plan table, so applyPlanLimits alone left
 * them unlocked forever). Only features that already have a row are touched.
 */
async function resetToStarter(tx: typeof prisma, orgId: string) {
  await applyPlanLimits(tx, orgId, 'STARTER')
  const planKeys = new Set(Object.keys(PLAN_LIMITS.STARTER))
  for (const featureKey of FEATURES.filter((f) => !planKeys.has(f))) {
    const limitInt = STARTER_LIMITS[featureKey] ?? 0
    await tx.entitlement.updateMany({
      where: { orgId, featureKey },
      data: { limitInt, remainingInt: limitInt },
    })
  }
}

/** Product+Plan that stand for a manually granted plan; created once if missing. */
async function resolvePlanProduct(tx: typeof prisma, plan: GrantablePlan) {
  const key = plan.toLowerCase()
  const existing = await tx.plan.findFirst({
    where: { key: { in: [key, plan === 'PROFESSIONAL' ? 'pro' : key] } },
    select: { productId: true },
  })
  if (existing) return existing.productId
  const product = await tx.product.create({
    data: {
      name: `JobSphere ${plan === 'PROFESSIONAL' ? 'Professional' : 'Enterprise'}`,
      plans: { create: { key, name: plan === 'PROFESSIONAL' ? 'Professional' : 'Enterprise' } },
    },
    select: { id: true },
  })
  return product.id
}

// ---------------------------------------------------------------- actions ---

export async function grantPlan(a: {
  orgId: string
  userId: string
  meta: object
  body: z.infer<typeof grantPlanSchema>
}) {
  const org = await requireLiveOrg(a.orgId)
  const { plan, until, reason } = a.body

  const out = await prisma.$transaction(async (tx) => {
    const current = await findLiveSubscription(a.orgId, tx)
    if (current) assertManual(current)

    const productId = await resolvePlanProduct(tx as typeof prisma, plan)
    const now = new Date()
    const metadata = {
      manual: true,
      planKey: plan,
      grantedBy: a.userId,
      reason,
      cancelAtPeriodEnd: false,
    }

    const sub = current
      ? await tx.subscription.update({
          where: { id: current.id },
          data: {
            productId,
            status: 'active',
            currentPeriodEnd: until,
            cancelAt: null,
            metadata,
          },
        })
      : await tx.subscription.create({
          data: {
            orgId: a.orgId,
            productId,
            providerSubId: `${MANUAL_PREFIX}${randomUUID()}`,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: until,
            metadata,
          },
        })

    await applyPlanLimits(tx as typeof prisma, a.orgId, plan)
    return { sub, previous: current }
  })

  await createAuditLog({
    userId: a.userId,
    orgId: a.orgId,
    action: out.previous ? 'UPDATE' : 'SUBSCRIPTION_CREATED',
    resource: 'SUBSCRIPTION',
    resourceId: out.sub.id,
    previous: out.previous
      ? {
          productId: out.previous.productId,
          status: out.previous.status,
          currentPeriodEnd: out.previous.currentPeriodEnd.toISOString(),
        }
      : { subscription: null },
    metadata: {
      op: 'admin_billing.grant_plan',
      plan,
      until: until.toISOString(),
      reason,
      organization: org.name,
    },
    ...a.meta,
  })
  return { subscriptionId: out.sub.id, plan }
}

export async function extendPeriod(a: {
  orgId: string
  userId: string
  meta: object
  body: z.infer<typeof extendSchema>
}) {
  await requireLiveOrg(a.orgId)
  const { until, reason } = a.body

  const current = await findLiveSubscription(a.orgId)
  if (!current) throw new BillingError('NO_ACTIVE_SUBSCRIPTION', 409, 'No active subscription')
  assertManual(current)
  if (until.getTime() <= current.currentPeriodEnd.getTime()) {
    throw new BillingError('NOT_AN_EXTENSION', 400, 'New date must be after the current period end')
  }

  const sub = await prisma.subscription.update({
    where: { id: current.id },
    data: {
      currentPeriodEnd: until,
      // Keep an already scheduled cancellation aligned with the new end.
      ...(current.cancelAt && current.cancelAt < until ? { cancelAt: until } : {}),
    },
  })

  await createAuditLog({
    userId: a.userId,
    orgId: a.orgId,
    action: 'UPDATE',
    resource: 'SUBSCRIPTION',
    resourceId: sub.id,
    previous: { currentPeriodEnd: current.currentPeriodEnd.toISOString() },
    metadata: { op: 'admin_billing.extend', until: until.toISOString(), reason },
    ...a.meta,
  })
  return { subscriptionId: sub.id }
}

export async function cancelSubscription(a: {
  orgId: string
  userId: string
  meta: object
  body: z.infer<typeof cancelSchema>
}) {
  await requireLiveOrg(a.orgId)
  const { mode, reason } = a.body

  const current = await findLiveSubscription(a.orgId)
  if (!current) throw new BillingError('NO_ACTIVE_SUBSCRIPTION', 409, 'No active subscription')
  assertManual(current)

  const now = new Date()
  const prevMeta = (current.metadata as Record<string, unknown> | null) ?? {}

  const sub = await prisma.$transaction(async (tx) => {
    if (mode === 'immediate') {
      const updated = await tx.subscription.update({
        where: { id: current.id },
        data: { status: 'canceled', canceledAt: now, endedAt: now, cancelAt: null },
      })
      await resetToStarter(tx as typeof prisma, a.orgId)
      return updated
    }
    return tx.subscription.update({
      where: { id: current.id },
      data: {
        cancelAt: current.currentPeriodEnd,
        metadata: { ...prevMeta, cancelAtPeriodEnd: true },
      },
    })
  })

  await createAuditLog({
    userId: a.userId,
    orgId: a.orgId,
    action: 'SUBSCRIPTION_CANCELED',
    resource: 'SUBSCRIPTION',
    resourceId: sub.id,
    previous: {
      status: current.status,
      cancelAt: current.cancelAt ? current.cancelAt.toISOString() : null,
    },
    metadata: { op: 'admin_billing.cancel', mode, reason },
    ...a.meta,
  })
  return { subscriptionId: sub.id, mode }
}

export async function setLimitOverride(a: {
  orgId: string
  userId: string
  meta: object
  body: z.infer<typeof limitSchema>
}) {
  await requireLiveOrg(a.orgId)
  const { featureKey, limit, reason } = a.body

  const before = await prisma.entitlement.findUnique({
    where: { orgId_featureKey: { orgId: a.orgId, featureKey } },
  })
  const previousLimit = before ? before.limitInt : (STARTER_LIMITS[featureKey] ?? null)

  await prisma.entitlement.upsert({
    where: { orgId_featureKey: { orgId: a.orgId, featureKey } },
    create: { orgId: a.orgId, featureKey, limitInt: limit, remainingInt: limit },
    update: { limitInt: limit, remainingInt: limit, deletedAt: null },
  })

  await createAuditLog({
    userId: a.userId,
    orgId: a.orgId,
    action: 'UPDATE',
    resource: 'SUBSCRIPTION',
    resourceId: a.orgId,
    previous: { featureKey, limit: previousLimit, hadOverride: Boolean(before) },
    metadata: { op: 'admin_billing.limit_override', featureKey, limit, reason },
    ...a.meta,
  })
  return { featureKey, limit }
}

// ------------------------------------------------------------ expiry job ---

export interface ExpiryResult {
  expired: number
  failed: number
}

/**
 * Daily job (Vercel Cron, /api/cron/manual-plan-expiry). Manual subscriptions get no Stripe
 * `subscription.deleted` webhook, so without this they never end: the plan *name* lapses via
 * the grace window in getCurrentPlan(), but every feature check reads the Entitlement rows,
 * which stayed on the granted limits forever.
 *
 * Ends manual subscriptions whose period ended more than the grace window ago, or whose
 * scheduled cancellation (`cancelAt`, set by "cancel at period end") has passed, then puts
 * the org back on STARTER — unless another live subscription (e.g. a real Stripe one) still
 * covers it. Each org is handled in its own transaction so one failure does not block the rest.
 */
export async function expireManualSubscriptions(now: Date = new Date()): Promise<ExpiryResult> {
  const cutoff = new Date(now.getTime() - PLAN_EXPIRY_GRACE_MS)
  const due = await prisma.subscription.findMany({
    where: {
      providerSubId: { startsWith: MANUAL_PREFIX },
      status: { in: ['active', 'trialing'] },
      OR: [{ currentPeriodEnd: { lte: cutoff } }, { cancelAt: { lte: now } }],
    },
    select: { id: true, orgId: true, status: true, currentPeriodEnd: true, cancelAt: true },
    take: 500,
  })

  let expired = 0
  let failed = 0
  for (const sub of due) {
    try {
      const reset = await prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'canceled',
            endedAt: now,
            ...(sub.cancelAt ? { canceledAt: sub.cancelAt } : {}),
          },
        })
        const stillLive = await tx.subscription.findFirst({
          where: { orgId: sub.orgId, id: { not: sub.id }, ...liveSubscriptionWhere(now) },
          select: { id: true },
        })
        if (stillLive) return false
        await resetToStarter(tx as typeof prisma, sub.orgId)
        return true
      })
      expired++
      await createAuditLog({
        // System actor: no userId — the entry is attributable to the cron job via `op`.
        orgId: sub.orgId,
        action: 'SUBSCRIPTION_CANCELED',
        resource: 'SUBSCRIPTION',
        resourceId: sub.id,
        previous: {
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
          cancelAt: sub.cancelAt ? sub.cancelAt.toISOString() : null,
        },
        metadata: {
          op: 'admin_billing.manual_expiry',
          reason: sub.cancelAt && sub.cancelAt <= now ? 'cancel_at_reached' : 'period_ended',
          limitsResetToStarter: reset,
        },
      })
    } catch (error) {
      failed++
      logger.error('Manual plan expiry failed', { subscriptionId: sub.id, error })
    }
  }
  return { expired, failed }
}
