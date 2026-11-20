/** Query building for the admin user list (shared by the API route and the page). */

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { ADMIN_ROLES, EMPLOYER_ORG_ROLES } from './roles'
import { SUSPENDED_THRESHOLD } from './guard'

export const USER_STATUS_FILTERS = ['active', 'suspended', 'locked', 'unverified'] as const

export const listQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  role: z.enum(ADMIN_ROLES).optional(),
  status: z.enum(USER_STATUS_FILTERS).optional(),
  sort: z.enum(['createdAt', 'lastLoginAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
export type ListQuery = z.infer<typeof listQuerySchema>

/** Empty strings from a form/URL are treated as "not set". */
export function parseListQuery(raw: Record<string, string | string[] | null | undefined>) {
  const clean: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const value = Array.isArray(v) ? v[0] : v
    if (value) clean[k] = value
  }
  return listQuerySchema.safeParse(clean)
}

export function buildWhere(q: ListQuery, now = new Date()): Prisma.UserWhereInput {
  const and: Prisma.UserWhereInput[] = [{ deletedAt: null }]

  if (q.search) {
    and.push({
      OR: [
        { email: { contains: q.search, mode: 'insensitive' } },
        { name: { contains: q.search, mode: 'insensitive' } },
      ],
    })
  }

  switch (q.role) {
    case 'ADMIN':
      and.push({ isGlobalAdmin: true })
      break
    case 'CANDIDATE':
      and.push({ candidates: { some: {} } })
      break
    case 'FREELANCER':
      and.push({ freelancerProfile: { isNot: null } })
      break
    case 'AGENCY':
      and.push({ organizations: { some: { role: 'AGENCY', deletedAt: null } } })
      break
    case 'EMPLOYER':
      and.push({
        organizations: {
          some: { role: { in: [...EMPLOYER_ORG_ROLES] }, deletedAt: null },
        },
      })
      break
  }

  switch (q.status) {
    case 'active':
      and.push({ OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] })
      break
    case 'suspended':
      and.push({ lockedUntil: { gte: SUSPENDED_THRESHOLD } })
      break
    case 'locked':
      and.push({ lockedUntil: { gt: now, lt: SUSPENDED_THRESHOLD } })
      break
    case 'unverified':
      and.push({ emailVerified: null })
      break
  }

  return { AND: and }
}

export function buildOrderBy(q: ListQuery): Prisma.UserOrderByWithRelationInput[] {
  if (q.sort === 'lastLoginAt') {
    return [{ lastLoginAt: { sort: q.order, nulls: 'last' } }, { createdAt: 'desc' }]
  }
  return [{ createdAt: q.order }]
}
