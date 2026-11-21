/**
 * Admin Users API
 * List, search, paginate and manage user status.
 * All endpoints require isGlobalAdmin.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata, type AuditAction } from '@/lib/audit-log'

/** The four admin actions, mapped onto audit vocabulary. */
const AUDIT_ACTION: Record<'ban' | 'unban' | 'promote_admin' | 'demote_admin', AuditAction> = {
  ban: 'BAN',
  unban: 'UNBAN',
  promote_admin: 'PROMOTE_ADMIN',
  demote_admin: 'DEMOTE_ADMIN',
}
import * as z from 'zod'
import { adminDenied, SUSPENDED_DATE } from '@/lib/admin-users/guard'
import { listAdminUsers } from '@/lib/admin-users/list'
import { parseListQuery } from '@/lib/admin-users/list-query'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

// Far-future date used as a "banned" (suspended) sentinel
const BAN_DATE = SUSPENDED_DATE

/** 401 for anonymous, 403 for a signed-in non-admin; otherwise the admin session. */
async function requireGlobalAdmin() {
  const session = await auth()
  const denied = adminDenied(session)
  if (denied) return denied
  return session!
}

const patchBodySchema = z.object({
  userId: z.string().min(1),
  action: z.enum(['ban', 'unban', 'promote_admin', 'demote_admin']),
})

/**
 * GET /api/admin/users
 * Returns paginated list of users with org count, searchable by name/email.
 */
const listUsers = async (req: Request) => {
  const authResult = await requireGlobalAdmin()
  if (authResult instanceof NextResponse) return authResult

  try {
    const { searchParams } = new URL(req.url)

    const parsed = parseListQuery(Object.fromEntries(searchParams.entries()))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', issues: parsed.error.issues },
        { status: 400 },
      )
    }
    const params = parsed.data

    const { users, total } = await listAdminUsers(params)

    logger.info('Admin: listed users', { adminId: authResult.user.id, total, page: params.page })

    return NextResponse.json({ users, total, page: params.page, limit: params.limit })
  } catch (error) {
    logger.error('Admin GET /users failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/users
 * Change user status: ban, unban, promote_admin, demote_admin.
 */
export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      const authResult = await requireGlobalAdmin()
      if (authResult instanceof NextResponse) return authResult

      try {
        const body: unknown = await req.json().catch(() => null)
        const { userId, action } = patchBodySchema.parse(body)

        // Prevent admins from acting on themselves for sensitive operations
        if (userId === authResult.user.id && (action === 'demote_admin' || action === 'ban')) {
          return NextResponse.json(
            { error: 'You cannot perform this action on your own account' },
            { status: 400 },
          )
        }

        const target = await prisma.user.findUnique({
          where: { id: userId },
          // isGlobalAdmin and lockedUntil come along so the audit entry can say
          // what the user WAS. "Promoted to admin" without the previous value
          // answers half the question.
          select: {
            id: true,
            deletedAt: true,
            isGlobalAdmin: true,
            lockedUntil: true,
            emailVerified: true,
            password: true,
          },
        })

        if (!target || target.deletedAt !== null) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }

        // A super admin cannot be suspended by another one (demote first), and the
        // platform must never be left without any super admin.
        if (action === 'ban' && target.isGlobalAdmin) {
          return NextResponse.json(
            { error: 'Cannot suspend a super admin. Demote first.' },
            { status: 403 },
          )
        }
        if (
          action === 'promote_admin' &&
          (!target.emailVerified ||
            !target.password ||
            (target.lockedUntil && target.lockedUntil > new Date()))
        ) {
          return NextResponse.json(
            { error: 'Account must have a verified e-mail, a password and not be suspended' },
            { status: 409 },
          )
        }
        if (action === 'demote_admin' && target.isGlobalAdmin) {
          const admins = await prisma.user.count({
            where: { isGlobalAdmin: true, deletedAt: null },
          })
          if (admins <= 1) {
            return NextResponse.json(
              { error: 'Cannot remove the last super admin' },
              { status: 409 },
            )
          }
        }

        let updateData: Record<string, unknown>

        switch (action) {
          case 'ban':
            // AUTH-001: bump sessionEpoch to immediately revoke the banned user's active JWTs
            updateData = { lockedUntil: BAN_DATE, sessionEpoch: { increment: 1 } }
            break
          case 'unban':
            updateData = { lockedUntil: null, failedAttempts: 0 }
            break
          case 'promote_admin':
            updateData = { isGlobalAdmin: true, sessionEpoch: { increment: 1 } }
            break
          case 'demote_admin':
            // AUTH-001: revoke active sessions so the demoted admin loses elevated access now
            updateData = { isGlobalAdmin: false, sessionEpoch: { increment: 1 } }
            break
        }

        const updated = await prisma.user.update({
          where: { id: userId },
          data: updateData,
          select: {
            id: true,
            name: true,
            email: true,
            isGlobalAdmin: true,
            lockedUntil: true,
            failedAttempts: true,
          },
        })

        logger.info('Admin: user action applied', { adminId: authResult.user.id, userId, action })

        await createAuditLog({
          userId: authResult.user.id,
          action: AUDIT_ACTION[action],
          resource: 'USER',
          resourceId: userId,
          previous: {
            isGlobalAdmin: target.isGlobalAdmin,
            lockedUntil: target.lockedUntil?.toISOString() ?? null,
          },
          metadata: {
            isGlobalAdmin: updated.isGlobalAdmin,
            lockedUntil: updated.lockedUntil?.toISOString() ?? null,
          },
          ...getRequestMetadata(req),
        })

        return NextResponse.json({ user: updated })
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'Invalid request body', issues: error.issues },
            { status: 400 },
          )
        }
        logger.error('Admin PATCH /users failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)

// Rate limiting was missing on this handler until the route wrapper contract
// test (tests/security/route-wrapper-contract.test.ts) enumerated the API surface.
export const GET = withRateLimit(listUsers, { preset: 'api', byUser: true })
