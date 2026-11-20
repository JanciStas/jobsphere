/**
 * POST /api/admin/users/[id]/password-reset
 * Starts a password reset for the account, reusing the VerificationToken flow of
 * /api/auth/forgot-password. mode "email" mails the link; if no mail provider is
 * configured (or delivery fails), or mode is "link", the link is returned to the
 * admin ONLY, with no-store. The link is a live credential: it is never logged
 * and never written to the audit trail.
 * Global admin only; not allowed on super admin accounts; audited.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { adminDenied, loadTarget, paramId, protectedAdminResponse } from '@/lib/admin-users/guard'
import { issuePasswordReset } from '@/lib/admin-users/password-reset'

export const runtime = 'nodejs'

const bodySchema = z.object({ mode: z.enum(['email', 'link']).default('email') }).strict()

export const POST = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      const id = paramId(context)
      if (!id) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

      const session = await auth()
      const denied = adminDenied(session)
      if (denied) return denied

      try {
        const raw: unknown = await req.json().catch(() => ({}))
        const parsed = bodySchema.safeParse(raw)
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Invalid request', issues: parsed.error.issues },
            { status: 400 },
          )
        }

        const target = await loadTarget(id)
        if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })
        const blocked = protectedAdminResponse(target)
        if (blocked) return blocked

        const result = await issuePasswordReset(target, target.locale, parsed.data.mode)

        logger.info('Admin: started password reset', {
          adminId: session!.user.id,
          targetId: id,
          delivery: result.delivery,
        })
        await createAuditLog({
          userId: session!.user.id,
          action: 'USER_UPDATED',
          resource: 'USER',
          resourceId: id,
          metadata: { op: 'PASSWORD_RESET_STARTED', delivery: result.delivery },
          ...getRequestMetadata(req),
        })

        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
      } catch (error) {
        logger.error('Admin POST /users/[id]/password-reset failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
    { preset: 'strict', byUser: true },
  ),
)
