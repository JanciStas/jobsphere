import { prisma } from '@/lib/prisma'

/** Roles allowed to post and manage gigs. HIRING_MANAGER only reviews candidates. */
export const GIG_MANAGER_ROLES = ['AGENCY', 'ORG_ADMIN', 'RECRUITER'] as const

/** Active membership in a non-suspended organization with a gig-managing role. */
function gigManagerMembership(userId: string) {
  return {
    userId,
    deletedAt: null,
    role: { in: [...GIG_MANAGER_ROLES] },
    // Admin "suspend" sets Organization.deletedAt; a suspended org must not manage gigs.
    organization: { deletedAt: null },
  }
}

/**
 * Organization ids where the user may manage gigs. Every gig mutation is scoped
 * with `orgId: { in: ids }` so a foreign gig is indistinguishable from a missing one.
 */
export async function getMemberOrgIds(userId: string): Promise<string[]> {
  const rows = await prisma.userOrgRole.findMany({
    where: gigManagerMembership(userId),
    select: { orgId: true },
  })
  return rows.map((r) => r.orgId)
}

/**
 * The single organization a new gig (or the gig list) belongs to. Deterministic for users
 * in several orgs: the agency membership of the active org first, then any agency
 * membership (same order as `requireAgency`), then the active org, then the oldest one.
 */
export async function resolveGigOrgId(
  userId: string,
  activeOrgId?: string | null,
): Promise<string | null> {
  const rows = await prisma.userOrgRole.findMany({
    where: gigManagerMembership(userId),
    select: { orgId: true, role: true },
    orderBy: { createdAt: 'asc' },
  })
  if (rows.length === 0) return null
  const agency = rows.filter((r) => r.role === 'AGENCY')
  const pick =
    agency.find((r) => r.orgId === activeOrgId) ??
    agency[0] ??
    rows.find((r) => r.orgId === activeOrgId) ??
    rows[0]
  return pick.orgId
}
