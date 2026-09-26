/**
 * Members of a specific organisation, from the platform admin side.
 *
 * This did not exist. An admin could see an organisation's members on
 * admin/organizations/[id] and change nothing about them: no route anywhere
 * wrote UserOrgRole from the admin surface. The only way to attach a user to an
 * organisation was POST /api/admin/organizations/invite, which always creates a
 * NEW organisation — so "add this person to that company" was not expressible.
 *
 * The employer-side equivalent lives in api/organizations/current/members and is
 * scoped to the caller's own organisation. Same shape, different authority:
 * requireGlobalAdmin instead of an ORG_ADMIN membership, and the organisation
 * comes from the URL rather than from the session.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireGlobalAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/errors'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export const ORG_ROLES = ['ORG_ADMIN', 'RECRUITER', 'SUB_HR', 'HIRING_MANAGER', 'AGENCY'] as const

const addMemberSchema = z.object({
  /** The user must already exist. Creating an account is what /invite is for. */
  email: z.string().email(),
  role: z.enum(ORG_ROLES).default('RECRUITER'),
})

function orgId(context?: { params?: Record<string, string> }): string | null {
  return context?.params?.id ?? null
}

export const GET = withRateLimit(
  async (_req: Request, context?: { params?: Record<string, string> }) => {
    try {
      const id = orgId(context)
      if (!id) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

      const admin = await requireGlobalAdmin()
      if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

      const members = await prisma.userOrgRole.findMany({
        where: { orgId: id },
        include: {
          user: { select: { id: true, name: true, email: true, avatar: true, deletedAt: true } },
        },
        orderBy: { createdAt: 'asc' },
      })

      return NextResponse.json({ members })
    } catch (error) {
      return handleApiError(error)
    }
  },
  { preset: 'api', byUser: true },
)

export const POST = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      try {
        const id = orgId(context)
        if (!id) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

        const admin = await requireGlobalAdmin()
        if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

        const { email, role } = addMemberSchema.parse(await req.json())

        const org = await prisma.organization.findUnique({ where: { id } })
        if (!org) {
          return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
        }

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
          select: { id: true, email: true, deletedAt: true },
        })

        if (!user || user.deletedAt) {
          // Deliberately explicit rather than silently provisioning an account:
          // this endpoint attaches an existing person to a company. Creating a
          // user is /invite's job, and conflating the two is how you end up with
          // duplicate accounts for the same person.
          return NextResponse.json(
            { error: 'No user with that email. Use the invite flow to create one.' },
            { status: 404 },
          )
        }

        const existing = await prisma.userOrgRole.findUnique({
          where: { userId_orgId: { userId: user.id, orgId: id } },
        })
        if (existing && !existing.deletedAt) {
          return NextResponse.json(
            { error: 'That user is already a member of this organization' },
            { status: 409 },
          )
        }

        const memberInclude = { user: { select: { id: true, name: true, email: true } } }
        // (userId, orgId) is the primary key: a removed member is reinstated, not re-created.
        const membership = existing
          ? await prisma.userOrgRole.update({
              where: { userId_orgId: { userId: user.id, orgId: id } },
              data: { role, deletedAt: null },
              include: memberInclude,
            })
          : await prisma.userOrgRole.create({
              data: { userId: user.id, orgId: id, role },
              include: memberInclude,
            })

        logger.info('Admin added org member', { adminId: admin.user.id, orgId: id, role })

        await createAuditLog({
          userId: admin.user.id,
          orgId: id,
          action: 'CREATE',
          resource: 'ORGANIZATION',
          resourceId: id,
          metadata: { addedUserId: user.id, email: user.email, role },
          ...getRequestMetadata(req),
        })

        return NextResponse.json({ member: membership }, { status: 201 })
      } catch (error) {
        return handleApiError(error)
      }
    },
    { preset: 'api', byUser: true },
  ),
)
