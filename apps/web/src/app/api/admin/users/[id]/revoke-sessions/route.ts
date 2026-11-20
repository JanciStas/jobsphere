/**
 * POST /api/admin/users/[id]/revoke-sessions
 * Signs the account out on every device by bumping User.sessionEpoch (AUTH-001).
 * The one action that is also allowed on super admin accounts: it is the
 * emergency brake for a compromised admin. Global admin only; audited.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { adminDenied, loadTarget, paramId } from '@/lib/admin-users/guard'

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

        await prisma.user.update({ where: { id }, data: { sessionEpoch: { increment: 1 } } })

        logger.info('Admin: revoked user sessions', { adminId: session!.user.id, targetId: id })
        await createAuditLog({
          userId: session!.user.id,
          action: 'USER_UPDATED',
          resource: 'USER',
          resourceId: id,
          metadata: { op: 'REVOKE_SESSIONS', targetIsAdmin: target.isGlobalAdmin },
          ...getRequestMetadata(req),
        })

        return NextResponse.json({ success: true })
      } catch (error) {
        logger.error('Admin POST /users/[id]/revoke-sessions failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
    { preset: 'api', byUser: true },
  ),
)
