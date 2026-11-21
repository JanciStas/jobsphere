/**
 * Data for the super-admin overview (/admin) and GET /api/admin/stats.
 *
 * Every block is fetched in its own try/catch (`safe`) so a single failing query shows "—"
 * for that tile instead of taking the whole page down. Nothing here returns secrets or
 * password hashes — only counts and a handful of display fields.
 *
 * Role derivation (a user can hold several):
 *  - agency     = UserOrgRole.role === 'AGENCY'
 *  - freelancer = FreelancerProfile row
 *  - employer   = ORG_ADMIN / RECRUITER / HIRING_MANAGER membership
 *  - candidate  = Candidate row
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { liveSubscriptionWhere } from '@/lib/entitlements'

export const EMPLOYER_ROLES = ['ORG_ADMIN', 'RECRUITER', 'HIRING_MANAGER']
const DAY = 86_400_000
/** Ban sentinel used by /api/admin/users (lockedUntil = 2099); not a "locked account". */
const BAN_SENTINEL = new Date('2098-01-01T00:00:00.000Z')

export type UserRoleKind = 'admin' | 'agency' | 'freelancer' | 'employer' | 'candidate' | 'user'

export async function safe<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (error) {
    logger.error(`Admin overview block failed: ${label}`, error)
    return null
  }
}

export interface AdminKpis {
  users: number | null
  newUsers7d: number | null
  candidates: number | null
  employers: number | null
  organizations: number | null
  agencies: number | null
  freelancers: number | null
  activeJobs: number | null
  openGigs: number | null
  activeSubscriptions: number | null
}

export async function getAdminKpis(now = new Date()): Promise<AdminKpis> {
  const since7d = new Date(now.getTime() - 7 * DAY)
  const live = { deletedAt: null }
  const [
    users,
    newUsers7d,
    candidates,
    employers,
    organizations,
    agencies,
    freelancers,
    activeJobs,
    openGigs,
    activeSubscriptions,
  ] = await Promise.all([
    safe('users', () => prisma.user.count({ where: live })),
    safe('newUsers7d', () =>
      prisma.user.count({ where: { ...live, createdAt: { gte: since7d } } }),
    ),
    safe('candidates', () => prisma.user.count({ where: { ...live, candidates: { some: {} } } })),
    safe('employers', () =>
      prisma.user.count({
        where: {
          ...live,
          organizations: { some: { deletedAt: null, role: { in: EMPLOYER_ROLES } } },
        },
      }),
    ),
    safe('organizations', () => prisma.organization.count({ where: live })),
    safe('agencies', () =>
      prisma.user.count({
        where: { ...live, organizations: { some: { deletedAt: null, role: 'AGENCY' } } },
      }),
    ),
    safe('freelancers', () => prisma.freelancerProfile.count()),
    safe('activeJobs', () => prisma.job.count({ where: { ...live, status: 'PUBLISHED' } })),
    safe('openGigs', () => prisma.gig.count({ where: { status: 'OPEN' } })),
    safe('activeSubscriptions', () =>
      // Same "live" rule as getCurrentPlan(): expired manual grants and Stripe rows whose
      // period lapsed (webhook never arrived) are not counted as active.
      prisma.subscription.count({ where: liveSubscriptionWhere() }),
    ),
  ])
  return {
    users,
    newUsers7d,
    candidates,
    employers,
    organizations,
    agencies,
    freelancers,
    activeJobs,
    openGigs,
    activeSubscriptions,
  }
}

export interface AttentionCounts {
  unverifiedOld: number | null
  locked: number | null
  dsarPending: number | null
  pastDue: number | null
}

export async function getAttentionCounts(now = new Date()): Promise<AttentionCounts> {
  const threeDaysAgo = new Date(now.getTime() - 3 * DAY)
  const [unverifiedOld, locked, dsarPending, pastDue] = await Promise.all([
    safe('unverifiedOld', () =>
      prisma.user.count({
        where: { deletedAt: null, emailVerified: null, createdAt: { lt: threeDaysAgo } },
      }),
    ),
    safe('locked', () =>
      prisma.user.count({
        where: { deletedAt: null, lockedUntil: { gt: now, lt: BAN_SENTINEL } },
      }),
    ),
    safe('dsarPending', () => prisma.dSARRequest.count({ where: { status: 'PENDING' } })),
    safe('pastDue', () =>
      prisma.subscription.count({ where: { status: { in: ['past_due', 'PAST_DUE'] } } }),
    ),
  ])
  return { unverifiedOld, locked, dsarPending, pastDue }
}

export function deriveRole(u: {
  isGlobalAdmin: boolean
  orgRoles: readonly string[]
  hasFreelancer: boolean
  hasCandidate: boolean
}): UserRoleKind {
  if (u.isGlobalAdmin) return 'admin'
  if (u.orgRoles.includes('AGENCY')) return 'agency'
  if (u.hasFreelancer) return 'freelancer'
  if (u.orgRoles.some((r) => EMPLOYER_ROLES.includes(r))) return 'employer'
  if (u.hasCandidate) return 'candidate'
  return 'user'
}

export interface RecentSignup {
  id: string
  name: string | null
  email: string
  createdAt: Date
  role: UserRoleKind
}

export async function getRecentSignups(take = 6): Promise<RecentSignup[] | null> {
  return safe('recentSignups', async () => {
    const rows = await prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        isGlobalAdmin: true,
        organizations: { where: { deletedAt: null }, select: { role: true } },
        freelancerProfile: { select: { id: true } },
        candidates: { select: { id: true }, take: 1 },
      },
    })
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      createdAt: r.createdAt,
      role: deriveRole({
        isGlobalAdmin: r.isGlobalAdmin,
        orgRoles: r.organizations.map((o) => o.role),
        hasFreelancer: !!r.freelancerProfile,
        hasCandidate: r.candidates.length > 0,
      }),
    }))
  })
}

export interface AdminActivityItem {
  id: string
  action: string
  entityType: string | null
  entityId: string | null
  createdAt: Date
  actorName: string | null
}

/** Latest AuditLog rows written by global admins. */
export async function getRecentAdminActivity(take = 6): Promise<AdminActivityItem[] | null> {
  return safe('adminActivity', async () => {
    const rows = await prisma.auditLog.findMany({
      where: { user: { isGlobalAdmin: true } },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
    })
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      createdAt: r.createdAt,
      actorName: r.user?.name || r.user?.email || null,
    }))
  })
}
