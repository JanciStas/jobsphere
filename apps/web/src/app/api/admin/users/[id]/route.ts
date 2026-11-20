/**
 * Admin User Detail API
 * Fetch detail and soft-delete a specific user.
 * All endpoints require isGlobalAdmin.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { adminDenied, loadTarget, protectedAdminResponse } from '@/lib/admin-users/guard'
import { loadUserDetail } from '@/lib/admin-users/detail'

export const runtime = 'nodejs'

async function requireGlobalAdmin() {
  const session = await auth()
  const denied = adminDenied(session)
  if (denied) return denied
  return session!
}

/**
 * GET /api/admin/users/[id]
 * Returns full user detail including organizations, application count and last 10 audit logs.
 */
const getUserDetail = async (_req: Request, context?: { params?: Record<string, string> }) => {
  const params = context?.params as { id: string }
  if (!params?.id) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
  }
  const authResult = await requireGlobalAdmin()
  if (authResult instanceof NextResponse) return authResult

  try {
    const user = await loadUserDetail(params.id)

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    logger.info('Admin: viewed user detail', { adminId: authResult.user.id, targetId: params.id })

    return NextResponse.json({ user })
  } catch (error) {
    logger.error('Admin GET /users/[id] failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const updateUserSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional().nullable(),
    phone: z.string().trim().max(50).optional().nullable(),
    locale: z.enum(['sk', 'en', 'de', 'cs', 'pl']).optional(),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    /** With an e-mail change: keep the account verified instead of requiring re-verification. */
    markVerified: z.boolean().optional(),
  })
  .strict()

/**
 * Edit a user's profile from the admin panel: name, phone, locale and e-mail.
 *
 * E-mail is the login identifier with a unique constraint, so changing it:
 *  - answers 409 when the address is already taken,
 *  - drops the old address's outstanding tokens and revokes every session,
 *  - resets verification (unless `markVerified`), because the new address has not
 *    proven ownership. Production login requires a verified address, so the admin
 *    either ticks `markVerified` or uses the "verify e-mail" action afterwards.
 *
 * Super admin accounts cannot be edited here.
 */
export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      const params = context?.params
      if (!params?.id) {
        return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
      }

      const authResult = await requireGlobalAdmin()
      if (authResult instanceof NextResponse) return authResult

      try {
        const parsed = updateUserSchema.safeParse(await req.json())
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Invalid request', issues: parsed.error.issues },
            { status: 400 },
          )
        }
        const data = parsed.data

        const target = await loadTarget(params.id)
        if (!target) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }
        const blocked = protectedAdminResponse(target)
        if (blocked) return blocked

        const emailChanged = data.email !== undefined && data.email !== target.email
        if (emailChanged) {
          const taken = await prisma.user.findUnique({
            where: { email: data.email },
            select: { id: true },
          })
          if (taken && taken.id !== target.id) {
            return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
          }
        }

        let updated
        try {
          updated = await prisma.user.update({
            where: { id: params.id },
            data: {
              ...(data.name !== undefined && { name: data.name }),
              ...(data.phone !== undefined && { phone: data.phone }),
              ...(data.locale !== undefined && { locale: data.locale }),
              ...(emailChanged && {
                email: data.email,
                emailVerified: data.markVerified ? new Date() : null,
                sessionEpoch: { increment: 1 },
              }),
            },
            select: { id: true, name: true, email: true, phone: true, locale: true },
          })
        } catch (error) {
          // Lost a race with another account taking the same address.
          if ((error as { code?: string })?.code === 'P2002') {
            return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
          }
          throw error
        }

        if (emailChanged) {
          await prisma.verificationToken.deleteMany({ where: { identifier: target.email } })
        }

        logger.info('Admin: updated user profile', {
          adminId: authResult.user.id,
          targetId: params.id,
          emailChanged,
        })

        await createAuditLog({
          userId: authResult.user.id,
          action: emailChanged ? 'EMAIL_CHANGED' : 'USER_UPDATED',
          resource: 'USER',
          resourceId: params.id,
          previous: {
            name: target.name,
            phone: target.phone,
            locale: target.locale,
            email: target.email,
          },
          metadata: {
            name: updated.name,
            phone: updated.phone,
            locale: updated.locale,
            email: updated.email,
            ...(emailChanged && {
              emailVerified: data.markVerified === true,
              sessionsRevoked: true,
            }),
          },
          ...getRequestMetadata(req),
        })

        return NextResponse.json({ user: updated })
      } catch (error) {
        logger.error('Admin PATCH /users/[id] failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
    { preset: 'api', byUser: true },
  ),
)

/**
 * DELETE /api/admin/users/[id]
 * Soft-deletes a user by setting deletedAt. Cannot delete yourself or another admin.
 */
export const DELETE = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      const params = context?.params as { id: string }
      if (!params?.id) {
        return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
      }
      const authResult = await requireGlobalAdmin()
      if (authResult instanceof NextResponse) return authResult

      try {
        if (params.id === authResult.user.id) {
          return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 })
        }

        const target = await prisma.user.findUnique({
          where: { id: params.id },
          select: { id: true, isGlobalAdmin: true, deletedAt: true },
        })

        if (!target || target.deletedAt !== null) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }

        if (target.isGlobalAdmin) {
          return NextResponse.json(
            { error: 'Cannot delete a global admin. Demote first.' },
            { status: 400 },
          )
        }

        await prisma.user.update({
          where: { id: params.id },
          // sessionEpoch bumped as well. Without it a soft-deleted user keeps a
          // valid JWT until it expires on its own — `ban` on the sibling route
          // has always done this, so deleting an account was the weaker of the
          // two ways to lock someone out.
          data: { deletedAt: new Date(), sessionEpoch: { increment: 1 } },
        })

        logger.info('Admin: soft-deleted user', {
          adminId: authResult.user.id,
          targetId: params.id,
        })

        await createAuditLog({
          userId: authResult.user.id,
          action: 'USER_DELETED',
          resource: 'USER',
          resourceId: params.id,
          previous: { deletedAt: null },
          metadata: { softDelete: true, sessionsRevoked: true },
          ...getRequestMetadata(req),
        })

        return NextResponse.json({ success: true })
      } catch (error) {
        logger.error('Admin DELETE /users/[id] failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)

// Rate limiting was missing on this handler until the route wrapper contract
// test (tests/security/route-wrapper-contract.test.ts) enumerated the API surface.
export const GET = withRateLimit(getUserDetail, { preset: 'api', byUser: true })
