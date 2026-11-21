/**
 * A single membership, from the platform admin side: change the role, or remove
 * the person from the organisation.
 *
 * Mirrors api/organizations/current/members/[userId] but authorises on
 * requireAdminApi and takes the organisation from the URL. The employer-side
 * route can only ever act on the caller's own organisation, which is why an
 * admin had no way to fix a membership in a company they do not belong to.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/errors'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { ORG_ROLES } from '../route'

export const runtime = 'nodejs'

const updateRoleSchema = z.object({ role: z.enum(ORG_ROLES) })

function ids(context?: { params?: Record<string, string> }) {
  const orgId = context?.params?.id
  const userId = context?.params?.userId
  return orgId && userId ? { orgId, userId } : null
}

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      try {
        const parsedIds = ids(context)
        if (!parsedIds) {
          return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
        }
        const { orgId, userId } = parsedIds

        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response
        const admin = guard.session

        const { role } = updateRoleSchema.parse(await req.json().catch(() => null))

        const membership = await prisma.userOrgRole.findUnique({
          where: { userId_orgId: { userId, orgId } },
        })
        if (!membership || membership.deletedAt) {
          return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
        }

        // Demoting the last ORG_ADMIN strands the company exactly like removing them
        // (DELETE below refuses that), so the same guard applies here.
        if (membership.role === 'ORG_ADMIN' && role !== 'ORG_ADMIN') {
          const admins = await prisma.userOrgRole.count({
            where: { orgId, role: 'ORG_ADMIN', deletedAt: null },
          })
          if (admins <= 1) {
            return NextResponse.json(
              { error: 'Cannot demote the last ORG_ADMIN. Promote someone else first.' },
              { status: 400 },
            )
          }
        }

        // Role and session revocation together: the new role has to take effect
        // now, not whenever the member's JWT happens to expire. The employer-side
        // route does the same for the same reason.
        const [updated] = await prisma.$transaction([
          prisma.userOrgRole.update({
            where: { userId_orgId: { userId, orgId } },
            data: { role },
            include: { user: { select: { id: true, name: true, email: true } } },
          }),
          prisma.user.update({
            where: { id: userId },
            data: { sessionEpoch: { increment: 1 } },
          }),
        ])

        logger.info('Admin changed org member role', { adminId: admin.user.id, orgId, userId })

        await createAuditLog({
          userId: admin.user.id,
          orgId,
          action: 'UPDATE',
          resource: 'ORGANIZATION',
          resourceId: orgId,
          previous: { memberId: userId, role: membership.role },
          metadata: { memberId: userId, role },
          ...getRequestMetadata(req),
        })

        return NextResponse.json({ member: updated })
      } catch (error) {
        return handleApiError(error)
      }
    },
    { preset: 'api', byUser: true },
  ),
)

export const DELETE = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      try {
        const parsedIds = ids(context)
        if (!parsedIds) {
          return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
        }
        const { orgId, userId } = parsedIds

        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response
        const admin = guard.session

        const membership = await prisma.userOrgRole.findUnique({
          where: { userId_orgId: { userId, orgId } },
        })
        if (!membership || membership.deletedAt) {
          return NextResponse.json({ error: 'Membership not found' }, { status: 404 })
        }

        // An organisation with no ORG_ADMIN cannot be administered by anyone —
        // its own settings, team and billing pages all require that role. Removing
        // the last one would strand the company.
        if (membership.role === 'ORG_ADMIN') {
          const admins = await prisma.userOrgRole.count({
            where: { orgId, role: 'ORG_ADMIN' },
          })
          if (admins <= 1) {
            return NextResponse.json(
              { error: 'Cannot remove the last ORG_ADMIN. Promote someone else first.' },
              { status: 400 },
            )
          }
        }

        await prisma.$transaction([
          prisma.userOrgRole.delete({ where: { userId_orgId: { userId, orgId } } }),
          prisma.user.update({
            where: { id: userId },
            data: { sessionEpoch: { increment: 1 } },
          }),
        ])

        logger.info('Admin removed org member', { adminId: admin.user.id, orgId, userId })

        await createAuditLog({
          userId: admin.user.id,
          orgId,
          action: 'DELETE',
          resource: 'ORGANIZATION',
          resourceId: orgId,
          previous: { memberId: userId, role: membership.role },
          metadata: { memberId: userId, removed: true },
          ...getRequestMetadata(req),
        })

        return NextResponse.json({ success: true })
      } catch (error) {
        return handleApiError(error)
      }
    },
    { preset: 'api', byUser: true },
  ),
)
