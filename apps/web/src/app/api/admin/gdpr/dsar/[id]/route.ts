/**
 * Admin DSAR Processing API
 *
 * Lets a global admin process a Data Subject Access Request:
 *   - For a DELETE request, executes the Right to Erasure (Art. 17) against the
 *     requesting user and marks the request COMPLETED.
 *   - For any request, allows marking it COMPLETED or REJECTED manually.
 *
 * All endpoints require isGlobalAdmin.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'

const processSchema = z.object({
  action: z.enum(['EXECUTE_DELETE', 'MARK_COMPLETED', 'REJECT']),
  rejectionReason: z.string().max(2000).optional(),
})
import { GdprService } from '@/services/gdpr.service'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

async function requireGlobalAdmin() {
  const session = await auth()
  if (!session?.user?.isGlobalAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return session
}

/**
 * POST /api/admin/gdpr/dsar/[id]
 * Body: { action: 'EXECUTE_DELETE' | 'MARK_COMPLETED' | 'REJECT', rejectionReason?: string }
 */
export const POST = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      const params = context?.params as { id: string }
      if (!params?.id) {
        return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
      }
      const authResult = await requireGlobalAdmin()
      if (authResult instanceof NextResponse) return authResult

      try {
        // Was a bare destructure of raw JSON: an unparseable body threw into the
        // 500 branch and a wrong-typed `rejectionReason` went straight to the
        // database. This route can hard-erase a person's data — it should be the
        // strictest input on the admin surface, not the loosest.
        const { action, rejectionReason } = processSchema.parse(await req.json().catch(() => null))

        const dsar = await prisma.dSARRequest.findUnique({ where: { id: params.id } })
        if (!dsar) {
          return NextResponse.json({ error: 'Request not found' }, { status: 404 })
        }

        if (action === 'EXECUTE_DELETE') {
          if (dsar.requestType !== 'DELETE') {
            return NextResponse.json(
              { error: 'This request is not a DELETE request' },
              { status: 400 },
            )
          }
          if (!dsar.userId) {
            return NextResponse.json(
              { error: 'Request has no linked user (already erased?)' },
              { status: 400 },
            )
          }

          const result = await GdprService.eraseUserData(dsar.userId)

          // userId FK is SetNull after the user is deleted; update by request id.
          await prisma.dSARRequest.update({
            where: { id: dsar.id },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
              responseData: {
                candidateIds: result.candidateIds,
                documentsDeleted: result.documentsDeleted,
                blobsDeleted: result.blobsDeleted,
                applicationsDeleted: result.applicationsDeleted,
                resumesDeleted: result.resumesDeleted,
              },
            },
          })

          await createAuditLog({
            userId: authResult.user.id,
            action: 'DSAR_PROCESSED',
            resource: 'DSAR',
            resourceId: dsar.id,
            previous: { status: dsar.status },
            metadata: {
              action: 'EXECUTE_DELETE',
              subjectUserId: dsar.userId,
              // Spread into a plain object: EraseUserResult is an interface
              // without an index signature, so Prisma's InputJsonValue rejects it.
              ...result,
            },
            ...getRequestMetadata(req),
          })

          logger.info('Admin: executed DSAR erasure', {
            adminId: authResult.user.id,
            requestId: dsar.id,
          })

          return NextResponse.json({ success: true, status: 'COMPLETED', result })
        }

        if (action === 'MARK_COMPLETED') {
          const updated = await prisma.dSARRequest.update({
            where: { id: dsar.id },
            data: { status: 'COMPLETED', completedAt: new Date() },
          })

          // Neither this branch nor REJECT logged anything at all — the two ways
          // to close a statutory request without acting on it left no trace.
          logger.info('Admin: marked DSAR completed', {
            adminId: authResult.user.id,
            requestId: dsar.id,
          })
          await createAuditLog({
            userId: authResult.user.id,
            action: 'DSAR_PROCESSED',
            resource: 'DSAR',
            resourceId: dsar.id,
            previous: { status: dsar.status },
            metadata: { action: 'MARK_COMPLETED' },
            ...getRequestMetadata(req),
          })

          return NextResponse.json({ success: true, request: updated })
        }

        if (action === 'REJECT') {
          const updated = await prisma.dSARRequest.update({
            where: { id: dsar.id },
            data: {
              status: 'REJECTED',
              completedAt: new Date(),
              rejectionReason: rejectionReason || 'Rejected by administrator',
            },
          })

          logger.info('Admin: rejected DSAR', {
            adminId: authResult.user.id,
            requestId: dsar.id,
          })
          await createAuditLog({
            userId: authResult.user.id,
            action: 'DSAR_PROCESSED',
            resource: 'DSAR',
            resourceId: dsar.id,
            previous: { status: dsar.status },
            metadata: { action: 'REJECT', rejectionReason: rejectionReason ?? null },
            ...getRequestMetadata(req),
          })

          return NextResponse.json({ success: true, request: updated })
        }

        return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'Invalid request', issues: error.issues },
            { status: 400 },
          )
        }
        logger.error('Admin DSAR processing failed', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)

/**
 * GET /api/admin/gdpr/dsar/[id]
 * Returns a single DSAR request for admin inspection.
 */
const getDsarRequest = async (_req: Request, context?: { params?: Record<string, string> }) => {
  const params = context?.params as { id: string }
  if (!params?.id) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
  }
  const authResult = await requireGlobalAdmin()
  if (authResult instanceof NextResponse) return authResult

  try {
    const dsar = await prisma.dSARRequest.findUnique({ where: { id: params.id } })
    if (!dsar) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }
    return NextResponse.json({ request: dsar })
  } catch (error) {
    logger.error('Admin DSAR GET failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Rate limiting was missing on this handler until the route wrapper contract
// test (tests/security/route-wrapper-contract.test.ts) enumerated the API surface.
export const GET = withRateLimit(getDsarRequest, { preset: 'api', byUser: true })
