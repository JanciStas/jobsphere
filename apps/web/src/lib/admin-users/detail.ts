/** Loads everything the admin user detail page/API shows. Never selects password, TOTP secret or tokens. */

import { prisma } from '@/lib/prisma'
import { deriveRoles, deriveStatus, type AccountStatus, type AdminRole } from './roles'

export interface AdminUserDetail {
  id: string
  name: string | null
  email: string
  avatar: string | null
  phone: string | null
  locale: string
  timezone: string
  createdAt: string
  updatedAt: string
  isGlobalAdmin: boolean
  roles: AdminRole[]
  status: AccountStatus
  lockedUntil: string | null
  security: {
    emailVerified: string | null
    totpEnabled: boolean
    failedAttempts: number
    lastLoginAt: string | null
    lastLoginIp: string | null
  }
  memberships: {
    orgId: string
    role: string
    orgName: string
    orgSlug: string
    joinedAt: string
  }[]
  hasCandidate: boolean
  hasFreelancer: boolean
  activity: {
    applications: number
    assignedApplications: number
    jobsCreated: number
    gigsCreated: number
    proposals: number
  }
  audit: {
    id: string
    action: string
    entityType: string | null
    direction: 'by' | 'on'
    actor: string | null
    createdAt: string
  }[]
}

export async function loadUserDetail(id: string): Promise<AdminUserDetail | null> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      phone: true,
      locale: true,
      timezone: true,
      emailVerified: true,
      totpEnabled: true,
      isGlobalAdmin: true,
      lockedUntil: true,
      failedAttempts: true,
      lastLoginAt: true,
      lastLoginIp: true,
      createdAt: true,
      updatedAt: true,
      organizations: {
        where: { deletedAt: null },
        select: {
          orgId: true,
          role: true,
          createdAt: true,
          organization: { select: { name: true, slug: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
      freelancerProfile: { select: { id: true } },
      candidates: { select: { id: true }, take: 1 },
      _count: { select: { assignedApps: true, createdJobs: true, gigs: true } },
    },
  })
  if (!user) return null

  const [applications, proposals, auditRows] = await Promise.all([
    prisma.application.count({ where: { candidate: { userId: id } } }),
    user.freelancerProfile
      ? prisma.gigProposal.count({ where: { freelancerId: user.freelancerProfile.id } })
      : Promise.resolve(0),
    prisma.auditLog.findMany({
      where: { OR: [{ userId: id }, { entityType: 'USER', entityId: id }] },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        userId: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
    }),
  ])

  const hasCandidate = user.candidates.length > 0
  const hasFreelancer = user.freelancerProfile !== null

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    phone: user.phone,
    locale: user.locale,
    timezone: user.timezone,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    isGlobalAdmin: user.isGlobalAdmin,
    roles: deriveRoles({
      isGlobalAdmin: user.isGlobalAdmin,
      orgRoles: user.organizations.map((o) => o.role),
      hasCandidate,
      hasFreelancer,
    }),
    status: deriveStatus(user.lockedUntil),
    lockedUntil: user.lockedUntil?.toISOString() ?? null,
    security: {
      emailVerified: user.emailVerified?.toISOString() ?? null,
      totpEnabled: user.totpEnabled,
      failedAttempts: user.failedAttempts,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      lastLoginIp: user.lastLoginIp,
    },
    memberships: user.organizations.map((m) => ({
      orgId: m.orgId,
      role: m.role,
      orgName: m.organization.name,
      orgSlug: m.organization.slug,
      joinedAt: m.createdAt.toISOString(),
    })),
    hasCandidate,
    hasFreelancer,
    activity: {
      applications,
      assignedApplications: user._count.assignedApps,
      jobsCreated: user._count.createdJobs,
      gigsCreated: user._count.gigs,
      proposals,
    },
    audit: auditRows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      direction: r.userId === id && !(r.entityType === 'USER' && r.entityId === id) ? 'by' : 'on',
      actor: r.user?.name ?? r.user?.email ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  }
}
