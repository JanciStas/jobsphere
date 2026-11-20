import { prisma } from '@/lib/prisma'

/**
 * Organization ids the user is an active member of. Every gig mutation is scoped
 * with `orgId: { in: ids }` so a foreign gig is indistinguishable from a missing one.
 */
export async function getMemberOrgIds(userId: string): Promise<string[]> {
  const rows = await prisma.userOrgRole.findMany({
    where: { userId, deletedAt: null },
    select: { orgId: true },
  })
  return rows.map((r) => r.orgId)
}
