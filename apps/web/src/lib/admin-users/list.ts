/** Loads one page of the admin user list. Never selects password hash, TOTP secret or tokens. */

import { prisma } from '@/lib/prisma'
import { buildOrderBy, buildWhere, type ListQuery } from './list-query'
import { deriveRoles, deriveStatus, type AccountStatus, type AdminRole } from './roles'

export interface AdminUserRow {
  id: string
  name: string | null
  email: string
  createdAt: string
  lastLoginAt: string | null
  emailVerified: boolean
  isGlobalAdmin: boolean
  status: AccountStatus
  roles: AdminRole[]
  company: string | null
  orgCount: number
}

export async function listAdminUsers(q: ListQuery) {
  const where = buildWhere(q)
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        lastLoginAt: true,
        emailVerified: true,
        isGlobalAdmin: true,
        lockedUntil: true,
        organizations: {
          where: { deletedAt: null },
          select: { role: true, organization: { select: { name: true } } },
        },
        candidates: { select: { id: true }, take: 1 },
        freelancerProfile: { select: { id: true } },
      },
      orderBy: buildOrderBy(q),
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.user.count({ where }),
  ])

  const users: AdminUserRow[] = rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    emailVerified: u.emailVerified !== null,
    isGlobalAdmin: u.isGlobalAdmin,
    status: deriveStatus(u.lockedUntil),
    roles: deriveRoles({
      isGlobalAdmin: u.isGlobalAdmin,
      orgRoles: u.organizations.map((o) => o.role),
      hasCandidate: u.candidates.length > 0,
      hasFreelancer: u.freelancerProfile !== null,
    }),
    company: u.organizations[0]?.organization.name ?? null,
    orgCount: u.organizations.length,
  }))

  return { users, total, page: q.page, limit: q.limit }
}
