/**
 * POST /api/admin/users/[id]/unlock
 * Clears a temporary lockout (failed login attempts). A suspended account is not
 * unlocked here: restoring it is the explicit "unban" action on /api/admin/users.
 * Global admin only; not allowed on super admin accounts; audited.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { adminDenied, loadTarget, paramId, protectedAdminResponse } from '@/lib/admin-users/guard'
import { deriveStatus } from '@/lib/admin-users/roles'

export const runtime = 'nodejs'

export const POST = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      const id = paramId(context)
      if (!id) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

      const session = await auth()
      const denied = adminDenied(session)
      if (denied) return denied

      try {
        const target = await loadTarget(id)
        if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
        const blocked = protectedAdminResponse(target)
        if (blocked) return blocked
        if (deriveStatus(target.lockedUntil) === 'SUSPENDED') {
          return NextResponse.json(
            { error: 'Account is suspended; restore it instead' },
            { status: 409 },
          )
        }

        await prisma.user.update({
          where: { id },
          data: { failedAttempts: 0, lockedUntil: null },
        })

        logger.info('Admin: unlocked user', { adminId: session!.user.id, targetId: id })
        await createAuditLog({
          userId: session!.user.id,
          action: 'USER_UPDATED',
          resource: 'USER',
          resourceId: id,
          previous: {
            failedAttempts: target.failedAttempts,
            lockedUntil: target.lockedUntil?.toISOString() ?? null,
          },
          metadata: { op: 'UNLOCK', failedAttempts: 0, lockedUntil: null },
          ...getRequestMetadata(req),
        })

        return NextResponse.json({ success: true })
      } catch (error) {
        logger.error('Admin POST /users/[id]/unlock failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
    { preset: 'api', byUser: true },
  ),
)
