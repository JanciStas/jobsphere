/**
 * Admin override of a proposal's status. Rule: at most one ACCEPTED proposal per
 * gig — accepting a second one is refused with 409 until the first is changed.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/errors'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { requireAdminApi } from '@/lib/admin-guard'
import { PROPOSAL_STATUSES } from '@/lib/admin-marketplace'

export const runtime = 'nodejs'

const patchSchema = z.object({ status: z.enum(PROPOSAL_STATUSES) }).strict()

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      try {
        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response
        const gigId = context?.params?.id
        const proposalId = context?.params?.proposalId
        if (!gigId || !proposalId) {
          return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
        }

        const { status } = patchSchema.parse(await req.json())

        // Scoped by gigId: a proposal id belonging to another gig is a 404.
        const proposal = await prisma.gigProposal.findFirst({
          where: { id: proposalId, gigId },
          select: { id: true, status: true, gig: { select: { orgId: true } } },
        })
        if (!proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })

        if (status === 'ACCEPTED') {
          const other = await prisma.gigProposal.findFirst({
            where: { gigId, status: 'ACCEPTED', id: { not: proposalId } },
            select: { id: true },
          })
          if (other) {
            return NextResponse.json(
              { error: 'Another proposal is already accepted for this gig' },
              { status: 409 },
            )
          }
        }

        const updated = await prisma.gigProposal.update({
          where: { id: proposalId },
          data: { status },
          select: { id: true, status: true },
        })

        await createAuditLog({
          userId: guard.session.user.id,
          orgId: proposal.gig.orgId,
          action: 'UPDATE',
          resource: 'GIG_PROPOSAL',
          resourceId: proposalId,
          previous: { gigId, status: proposal.status },
          metadata: { gigId, status: updated.status },
          ...getRequestMetadata(req),
        })
        logger.info(`Admin set proposal ${proposalId} to ${status} by ${guard.session.user.id}`)
        return NextResponse.json({ proposal: updated })
      } catch (error) {
        logger.error('Admin PATCH proposal error:', error)
        return handleApiError(error)
      }
    },
    { preset: 'api' },
  ),
)
