/**
 * Accept / reject a gig proposal (company decision).
 * Accept → proposal ACCEPTED, gig → IN_PROGRESS, other pending proposals → REJECTED.
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { getMemberOrgIds } from '../../../_lib/org-scope'

/** Thrown inside the transaction so the gig status change is rolled back too. */
class ConflictError extends Error {}

const actionSchema = z.object({ action: z.enum(['ACCEPT', 'REJECT']) })

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (request: Request, context?: { params?: Record<string, string> }) => {
      try {
        const gigId = context?.params?.id
        const proposalId = context?.params?.proposalId
        if (!gigId || !proposalId) {
          return NextResponse.json({ error: 'Missing parameters' }, { status: 400 })
        }

        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const gig = await prisma.gig.findUnique({ where: { id: gigId }, select: { orgId: true } })
        if (!gig) return NextResponse.json({ error: 'Gig not found' }, { status: 404 })

        // Only a gig manager (agency / org admin / recruiter) of the gig's active org may decide.
        const orgIds = await getMemberOrgIds(session.user.id)
        if (!orgIds.includes(gig.orgId)) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const parsed = actionSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) {
          return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
        }

        // Ensure the proposal actually belongs to THIS gig (the gig is already
        // confirmed to belong to the caller's org). Without this scope a member
        // could PATCH another org's proposal by passing a foreign proposalId with
        // their own gigId in the URL (cross-gig IDOR).
        const proposal = await prisma.gigProposal.findFirst({
          where: { id: proposalId, gigId },
          select: { id: true },
        })
        if (!proposal) {
          return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
        }

        // Only a PENDING proposal can be decided, and only on an OPEN gig. Both conditions
        // live in the conditional writes themselves, so a concurrent withdraw / second accept
        // cannot slip in between a read and the write.
        const outcome = await prisma.$transaction(async (tx) => {
          const gigUpdate = await tx.gig.updateMany({
            where: { id: gigId, status: 'OPEN' },
            data: parsed.data.action === 'ACCEPT' ? { status: 'IN_PROGRESS' } : {},
          })
          if (gigUpdate.count === 0) return 'GIG_NOT_OPEN' as const

          const decided = await tx.gigProposal.updateMany({
            where: { id: proposalId, gigId, status: 'PENDING' },
            data: { status: parsed.data.action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED' },
          })
          if (decided.count === 0) throw new ConflictError()

          if (parsed.data.action === 'ACCEPT') {
            await tx.gigProposal.updateMany({
              where: { gigId, id: { not: proposalId }, status: 'PENDING' },
              data: { status: 'REJECTED' },
            })
          }
          return 'OK' as const
        })

        if (outcome === 'GIG_NOT_OPEN') {
          return NextResponse.json(
            { error: 'This gig no longer accepts decisions' },
            { status: 409 },
          )
        }
        return NextResponse.json({
          ok: true,
          status: parsed.data.action === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED',
        })
      } catch (error) {
        if (error instanceof ConflictError) {
          return NextResponse.json(
            { error: 'This proposal has already been decided or withdrawn' },
            { status: 409 },
          )
        }
        logger.error('Proposal decision error', { error })
        return NextResponse.json({ error: 'Failed to update proposal' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)
