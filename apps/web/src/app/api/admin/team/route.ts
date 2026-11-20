/**
 * Admin team API — who holds User.isGlobalAdmin.
 *
 * GET  /api/admin/team            list global admins
 * POST /api/admin/team {email}    promote an EXISTING user to global admin
 *
 * Removal lives in ./[id]/route.ts. Every write bumps the affected user's sessionEpoch (forces a
 * fresh sign-in so the JWT picks up the new privilege level) and writes an audit entry.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const addSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
})

const ADMIN_SELECT = {
  id: true,
  name: true,
  email: true,
  lastLoginAt: true,
  createdAt: true,
} as const

async function guard() {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!session.user.isGlobalAdmin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { session }
}

const listAdmins = async () => {
  const g = await guard()
  if (g.error) return g.error
  try {
    const admins = await prisma.user.findMany({
      where: { isGlobalAdmin: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: ADMIN_SELECT,
    })
    return NextResponse.json({ admins })
  } catch (error) {
    logger.error('Admin GET /team failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const GET = withRateLimit(listAdmins, { preset: 'api', byUser: true })

export const POST = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      const g = await guard()
      if (g.error) return g.error
      const { session } = g

      try {
        const parsed = addSchema.safeParse(await req.json().catch(() => null))
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Invalid request', issues: parsed.error.issues },
            { status: 400 },
          )
        }

        const target = await prisma.user.findUnique({
          where: { email: parsed.data.email },
          select: {
            id: true,
            isGlobalAdmin: true,
            deletedAt: true,
            emailVerified: true,
            lockedUntil: true,
            password: true,
          },
        })
        if (!target || target.deletedAt !== null) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }
        if (target.isGlobalAdmin) {
          return NextResponse.json({ error: 'User is already an admin' }, { status: 409 })
        }
        // Never hand super admin to an account whose owner is unproven (pre-registered
        // address), suspended, or without a password.
        if (
          !target.emailVerified ||
          !target.password ||
          (target.lockedUntil && target.lockedUntil > new Date())
        ) {
          return NextResponse.json(
            { error: 'Account must have a verified e-mail, a password and not be suspended' },
            { status: 409 },
          )
        }

        const admin = await prisma.user.update({
          where: { id: target.id },
          data: { isGlobalAdmin: true, sessionEpoch: { increment: 1 } },
          select: ADMIN_SELECT,
        })

        await createAuditLog({
          userId: session!.user.id,
          action: 'PROMOTE_ADMIN',
          resource: 'USER',
          resourceId: target.id,
          previous: { isGlobalAdmin: false },
          metadata: { isGlobalAdmin: true, sessionsRevoked: true, via: 'admin-team' },
          ...getRequestMetadata(req),
        })

        return NextResponse.json({ admin }, { status: 201 })
      } catch (error) {
        logger.error('Admin POST /team failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
    { preset: 'strict', byUser: true },
  ),
)
