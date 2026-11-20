/**
 * DELETE /api/admin/team/[id] — remove global-admin rights from a user.
 *
 * Safeguards: you cannot remove yourself, and the last remaining admin can never be removed.
 * The affected user's sessionEpoch is bumped so their existing JWT stops working.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export const DELETE = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      const session = await auth()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      if (!session.user.isGlobalAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }

      const id = context?.params?.id
      if (!id || !ID_RE.test(id)) {
        return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
      }
      if (id === session.user.id) {
        return NextResponse.json(
          { error: 'You cannot remove your own admin rights' },
          { status: 400 },
        )
      }

      try {
        const target = await prisma.user.findUnique({
          where: { id },
          select: { id: true, isGlobalAdmin: true, deletedAt: true },
        })
        if (!target || target.deletedAt !== null) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }
        if (!target.isGlobalAdmin) {
          return NextResponse.json({ error: 'User is not an admin' }, { status: 400 })
        }

        const adminCount = await prisma.user.count({
          where: { isGlobalAdmin: true, deletedAt: null },
        })
        if (adminCount <= 1) {
          return NextResponse.json({ error: 'Cannot remove the last admin' }, { status: 400 })
        }

        await prisma.user.update({
          where: { id },
          data: { isGlobalAdmin: false, sessionEpoch: { increment: 1 } },
        })

        await createAuditLog({
          userId: session.user.id,
          action: 'DEMOTE_ADMIN',
          resource: 'USER',
          resourceId: id,
          previous: { isGlobalAdmin: true },
          metadata: { isGlobalAdmin: false, sessionsRevoked: true, via: 'admin-team' },
          ...getRequestMetadata(req),
        })

        return NextResponse.json({ success: true })
      } catch (error) {
        logger.error('Admin DELETE /team/[id] failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
    { preset: 'strict', byUser: true },
  ),
)
