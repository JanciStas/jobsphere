/**
 * POST /api/admin/users/[id]/verify-email
 * Marks the account's e-mail as verified by hand (support case: the mail never arrived).
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
        if (target.emailVerified) {
          return NextResponse.json({ error: 'Email is already verified' }, { status: 409 })
        }

        const verifiedAt = new Date()
        await prisma.user.update({ where: { id }, data: { emailVerified: verifiedAt } })

        logger.info('Admin: verified user email', { adminId: session!.user.id, targetId: id })
        await createAuditLog({
          userId: session!.user.id,
          action: 'USER_UPDATED',
          resource: 'USER',
          resourceId: id,
          previous: { emailVerified: null },
          metadata: { op: 'VERIFY_EMAIL', emailVerified: verifiedAt.toISOString() },
          ...getRequestMetadata(req),
        })

        return NextResponse.json({ success: true, emailVerified: verifiedAt.toISOString() })
      } catch (error) {
        logger.error('Admin POST /users/[id]/verify-email failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
    { preset: 'api', byUser: true },
  ),
)
