/**
 * Login/signup portals (role-specific entry points).
 *
 * Pure helpers (no Prisma / no React) so they can be shared by the server-side
 * `authorize` in lib/auth.ts, the middleware and the login/signup clients.
 */

export const PORTALS = ['candidate', 'agency', 'freelancer', 'employer'] as const
export type Portal = (typeof PORTALS)[number]

const EMPLOYER_ROLES = ['ORG_ADMIN', 'RECRUITER', 'HIRING_MANAGER']

export function isPortal(value: unknown): value is Portal {
  return typeof value === 'string' && (PORTALS as readonly string[]).includes(value)
}

export interface PortalIdentity {
  /** UserOrgRole.role values of the user's (non-deleted) memberships. */
  orgRoles: readonly string[]
  hasCandidate: boolean
  hasFreelancer: boolean
}

/**
 * Does the account hold the identity required by the portal?
 *  - candidate: has a Candidate row, or has neither an org role nor a FreelancerProfile
 *  - agency: UserOrgRole.role === 'AGENCY'
 *  - freelancer: has a FreelancerProfile
 *  - employer: ORG_ADMIN / RECRUITER / HIRING_MANAGER membership
 */
export function userMatchesPortal(portal: Portal, identity: PortalIdentity): boolean {
  const { orgRoles, hasCandidate, hasFreelancer } = identity
  switch (portal) {
    case 'candidate':
      return hasCandidate || (orgRoles.length === 0 && !hasFreelancer)
    case 'agency':
      return orgRoles.includes('AGENCY')
    case 'freelancer':
      return hasFreelancer
    case 'employer':
      return orgRoles.some((r) => EMPLOYER_ROLES.includes(r))
    default:
      return false
  }
}

/** All portals this account may sign in through (used to guide a user who picked the wrong one). */
export function matchingPortals(identity: PortalIdentity): Portal[] {
  return PORTALS.filter((p) => userMatchesPortal(p, identity))
}

/** Where to land after sign-in / sign-up for a given portal (locale-prefixed). */
export function portalHome(portal: Portal, locale: string): string {
  switch (portal) {
    case 'agency':
      return `/${locale}/agency/dashboard`
    case 'freelancer':
      return `/${locale}/freelancer/dashboard`
    case 'employer':
      return `/${locale}/employer`
    default:
      return `/${locale}/dashboard`
  }
}

/** Which portal a (locale-less) protected path clearly belongs to, else null. */
export function portalForPath(pathWithoutLocale: string): Portal | null {
  if (pathWithoutLocale === '/agency' || pathWithoutLocale.startsWith('/agency/')) return 'agency'
  if (
    pathWithoutLocale === '/freelancer/dashboard' ||
    pathWithoutLocale.startsWith('/freelancer/dashboard/')
  )
    return 'freelancer'
  if (pathWithoutLocale === '/employer' || pathWithoutLocale.startsWith('/employer/'))
    return 'employer'
  if (pathWithoutLocale === '/dashboard' || pathWithoutLocale.startsWith('/dashboard/'))
    return 'candidate'
  return null
}
