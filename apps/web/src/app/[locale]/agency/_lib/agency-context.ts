import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export interface AgencyContext {
  userId: string
  /** Organization of the agency membership every query on /agency is scoped to. */
  orgId: string
}

/**
 * Server-side guard for the agency area (also callable from pages, as layouts
 * cannot hand data to their children). Anonymous -> agency login; employer
 * members -> /employer; everybody else (candidates, freelancers) -> /dashboard.
 */
export async function requireAgency(locale: string): Promise<AgencyContext> {
  const session = await auth()
  if (!session?.user?.id) {
    redirect(`/${locale}/login/agency`)
  }
  const userId = session.user.id

  const memberships = await prisma.userOrgRole.findMany({
    // A suspended organization (admin) loses access to its dashboard.
    where: { userId, deletedAt: null, organization: { deletedAt: null } },
    select: { orgId: true, role: true },
  })
  const agencyOrgs = memberships.filter((m) => m.role === 'AGENCY')
  if (agencyOrgs.length === 0) {
    redirect(memberships.length > 0 ? `/${locale}/employer` : `/${locale}/dashboard`)
  }

  const active = agencyOrgs.find((m) => m.orgId === session.user.orgId)
  return { userId, orgId: (active ?? agencyOrgs[0]).orgId }
}
