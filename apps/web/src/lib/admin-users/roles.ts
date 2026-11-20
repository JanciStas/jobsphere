/** Platform roles as shown in the admin user list/detail (derived, not stored). */

export const ADMIN_ROLES = ['ADMIN', 'EMPLOYER', 'AGENCY', 'CANDIDATE', 'FREELANCER'] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

export const EMPLOYER_ORG_ROLES = ['ORG_ADMIN', 'RECRUITER', 'SUB_HR', 'HIRING_MANAGER'] as const

export interface RoleSource {
  isGlobalAdmin: boolean
  orgRoles: readonly string[]
  hasCandidate: boolean
  hasFreelancer: boolean
}

export function deriveRoles(src: RoleSource): AdminRole[] {
  const roles: AdminRole[] = []
  if (src.isGlobalAdmin) roles.push('ADMIN')
  if (src.orgRoles.some((r) => (EMPLOYER_ORG_ROLES as readonly string[]).includes(r))) {
    roles.push('EMPLOYER')
  }
  if (src.orgRoles.includes('AGENCY')) roles.push('AGENCY')
  if (src.hasCandidate) roles.push('CANDIDATE')
  if (src.hasFreelancer) roles.push('FREELANCER')
  return roles
}

export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'LOCKED'

/** lockedUntil >= 2098 is the admin suspension sentinel; a nearer future date is a lockout. */
export function deriveStatus(lockedUntil: Date | string | null, now = new Date()): AccountStatus {
  if (!lockedUntil) return 'ACTIVE'
  const until = new Date(lockedUntil)
  if (until <= now) return 'ACTIVE'
  return until >= new Date('2098-01-01T00:00:00.000Z') ? 'SUSPENDED' : 'LOCKED'
}

/** lockedUntil at/after this instant means "suspended" (kept here so client code can import it without Prisma). */
export const SUSPENDED_THRESHOLD = new Date('2098-01-01T00:00:00.000Z')
