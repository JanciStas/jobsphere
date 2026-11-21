/**
 * Entitlements Library
 * Feature gates and usage limits based on subscription
 */

import { prisma } from './db'
import { logger } from './logger'

export type Feature =
  | 'MAX_JOBS'
  | 'MAX_CANDIDATES'
  | 'MAX_TEAM_MEMBERS'
  | 'EMAIL_SEQUENCES'
  | 'ASSESSMENTS'
  | 'AI_MATCHING'
  | 'CUSTOM_BRANDING'
  | 'API_ACCESS'

/**
 * STARTER (free) plan defaults.
 *
 * These are the limits applied when an organization has NO entitlement record
 * for a feature (e.g. every new/free org that never went through Stripe
 * checkout). Without this, a missing record would either grant unlimited
 * access (revenue leak) or block everything.
 *
 * Semantics for limit values everywhere in this module:
 *   - `null`            => UNLIMITED (e.g. ENTERPRISE)
 *   - a positive number => quota / capacity limit
 *   - `0`               => feature disabled / no access
 */
export const STARTER_LIMITS: Record<Feature, number | null> = {
  MAX_JOBS: 5,
  MAX_CANDIDATES: 50,
  MAX_TEAM_MEMBERS: 2,
  EMAIL_SEQUENCES: 0,
  ASSESSMENTS: 0,
  AI_MATCHING: 0,
  CUSTOM_BRANDING: 0,
  API_ACCESS: 0,
}

/**
 * Check if organization has access to a feature
 */
export async function hasFeature(orgId: string, feature: Feature): Promise<boolean> {
  const entitlement = await prisma.entitlement.findUnique({
    where: {
      orgId_featureKey: {
        orgId,
        featureKey: feature,
      },
    },
  })

  // Missing record => fall back to the STARTER default for this feature.
  if (!entitlement) {
    return STARTER_LIMITS[feature] === null || (STARTER_LIMITS[feature] ?? 0) > 0
  }

  // limitInt === null => unlimited (enabled). Otherwise limitInt > 0 => enabled.
  if (entitlement.limitInt === null) return true
  return entitlement.limitInt > 0
}

/**
 * Get feature limit for organization
 */
export async function getFeatureLimit(orgId: string, feature: Feature): Promise<number | null> {
  const entitlement = await prisma.entitlement.findUnique({
    where: {
      orgId_featureKey: {
        orgId,
        featureKey: feature,
      },
    },
  })

  // Missing record => apply the STARTER default (NOT 0, which would lock free
  // orgs out entirely, and NOT unlimited, which would leak revenue).
  if (!entitlement) return STARTER_LIMITS[feature]

  // Preserve null for unlimited limits (e.g. ENTERPRISE).
  return entitlement.limitInt
}

/**
 * Check if organization can create more items
 */
export async function canCreateJob(orgId: string): Promise<boolean> {
  const limit = await getFeatureLimit(orgId, 'MAX_JOBS')

  if (limit === null) return true // unlimited

  const currentCount = await prisma.job.count({
    where: { orgId: orgId, status: 'PUBLISHED' },
  })

  return currentCount < limit
}

export async function canAddCandidate(orgId: string): Promise<boolean> {
  const limit = await getFeatureLimit(orgId, 'MAX_CANDIDATES')

  if (limit === null) return true

  const currentCount = await prisma.application.count({
    // Application.orgId is its own non-nullable column (always set to job.orgId on
    // create); filtering it directly avoids a join against Job.
    where: { orgId },
  })

  return currentCount < limit
}

export async function canAddTeamMember(orgId: string): Promise<boolean> {
  const limit = await getFeatureLimit(orgId, 'MAX_TEAM_MEMBERS')

  if (limit === null) return true

  const currentCount = await prisma.userOrgRole.count({
    where: { orgId },
  })

  return currentCount < limit
}

/** How long a subscription stays "live" after its period end (absorbs Stripe webhook lag). */
export const PLAN_EXPIRY_GRACE_MS = 3 * 24 * 60 * 60 * 1000

/**
 * The one rule for "this subscription is live": active/trialing (Stripe's lowercase
 * vocabulary, see webhook) and its period has not ended more than the grace window ago.
 * Manually granted plans (admin) have no Stripe renewal, so they must lapse on their own.
 * Used by getCurrentPlan(), the admin billing actions/pages and the admin KPIs.
 */
export function liveSubscriptionWhere(now: Date = new Date()) {
  return {
    status: { in: ['active', 'trialing'] },
    currentPeriodEnd: { gt: new Date(now.getTime() - PLAN_EXPIRY_GRACE_MS) },
  }
}

/**
 * Get current plan for organization
 */
export async function getCurrentPlan(
  orgId: string,
): Promise<'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' | null> {
  const subscription = await prisma.subscription.findFirst({
    where: {
      orgId,
      ...liveSubscriptionWhere(),
    },
    include: {
      product: {
        include: { plans: true },
      },
    },
    orderBy: { currentPeriodEnd: 'desc' },
  })

  if (!subscription) return 'STARTER'

  // Strategy 1: Check product relationship for plan
  const plan = subscription.product.plans[0]
  if (plan?.key) {
    const planKey = plan.key.toUpperCase()
    if (planKey === 'STARTER' || planKey === 'PROFESSIONAL' || planKey === 'ENTERPRISE') {
      return planKey as 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE'
    }
  }

  // Strategy 2: Check subscription metadata for planKey
  const metadata = subscription.metadata as any
  if (metadata?.planKey) {
    const planKey = metadata.planKey.toUpperCase()
    if (planKey === 'STARTER' || planKey === 'PROFESSIONAL' || planKey === 'ENTERPRISE') {
      return planKey as 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE'
    }
  }

  // Strategy 3: Parse product name
  const productName = subscription.product.name.toLowerCase()
  if (productName.includes('enterprise')) return 'ENTERPRISE'
  if (productName.includes('professional') || productName.includes('pro')) return 'PROFESSIONAL'

  // Default fallback
  return 'STARTER'
}

/**
 * Get all entitlements for organization
 */
export async function getEntitlements(orgId: string) {
  const entitlements = await prisma.entitlement.findMany({
    where: { orgId },
  })

  const plan = await getCurrentPlan(orgId)

  return {
    plan,
    features: entitlements.reduce(
      (acc, e) => {
        acc[e.featureKey] = {
          enabled: (e.limitInt ?? 0) > 0,
          limit: e.limitInt,
          used: e.limitInt !== null && e.remainingInt !== null ? e.limitInt - e.remainingInt : 0,
        }
        return acc
      },
      {} as Record<string, { enabled: boolean; limit: number | null; used: number }>,
    ),
  }
}

/**
 * Middleware helper - throws if feature not enabled
 */
export async function requireFeature(orgId: string, feature: Feature) {
  const enabled = await hasFeature(orgId, feature)

  if (!enabled) {
    throw new Error(`Feature ${feature} not available on your plan. Please upgrade.`)
  }
}

/**
 * Increment usage for a feature
 */
export async function incrementUsage(orgId: string, feature: Feature) {
  await prisma.entitlement.update({
    where: {
      orgId_featureKey: {
        orgId,
        featureKey: feature,
      },
    },
    data: {
      remainingInt: {
        decrement: 1,
      },
    },
  })
}

/**
 * Check if organization has entitlement capacity for a feature
 * Returns true if organization can use/create more of the feature
 */
export async function checkEntitlement(orgId: string, feature: Feature): Promise<boolean> {
  const entitlement = await prisma.entitlement.findUnique({
    where: {
      orgId_featureKey: {
        orgId,
        featureKey: feature,
      },
    },
  })

  // No record => fall back to the STARTER default for this feature.
  //   STARTER null  => unlimited        => allow
  //   STARTER 0     => disabled         => deny
  //   STARTER > 0   => has a quota      => allow (capacity is enforced by the
  //                                        count-based canCreateJob/canAddCandidate
  //                                        gates; a missing record has no
  //                                        remaining counter to consult).
  if (!entitlement) {
    const starter = STARTER_LIMITS[feature]
    return starter === null || starter > 0
  }

  // limitInt === null => UNLIMITED. Must come BEFORE the `?? 0` coercion that
  // previously mis-read unlimited as "limit 0 => deny" and blocked ENTERPRISE.
  if (entitlement.limitInt === null) {
    return true
  }

  // limit 0 => feature disabled / no access.
  if (entitlement.limitInt === 0) {
    return false
  }

  // Positive limit => allow while there is remaining capacity. A null
  // remainingInt on a positive limit means the counter was never initialized;
  // treat that as full capacity rather than blocked.
  const remaining = entitlement.remainingInt ?? entitlement.limitInt
  return remaining > 0
}

/**
 * Consume entitlement capacity (decrement remaining count)
 * @param orgId Organization ID
 * @param feature Feature to consume
 * @param amount Amount to consume (default: 1)
 * @param tx Optional Prisma transaction client
 */
export async function consumeEntitlement(
  orgId: string,
  feature: Feature,
  amount: number = 1,
  tx?: typeof prisma,
): Promise<void> {
  const client = tx ?? prisma

  // Tolerate missing entitlement records (new orgs without seeded entitlements):
  // updateMany returns {count} instead of throwing P2025 when the row is absent.
  const result = await client.entitlement.updateMany({
    where: { orgId, featureKey: feature },
    data: { remainingInt: { decrement: amount } },
  })
  if (result.count === 0) {
    logger.warn('Entitlement consume no-op — no matching record', { orgId, feature })
  }
}
