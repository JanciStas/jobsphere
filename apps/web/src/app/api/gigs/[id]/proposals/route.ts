/**
 * Gig proposals API.
 *  - POST: a freelancer submits a proposal (rate, duration, message) for an OPEN gig.
 *  - GET:  the gig's company lists received proposals (with freelancer info).
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'
import { z } from 'zod'
import { logger } from '@/lib/logger'

export const GET = withRateLimit(
  async (_req: Request, context?: { params?: Record<string, string> }) => {
    const gigId = context?.params?.id
    if (!gigId) return NextResponse.json({ error: 'Missing gig id' }, { status: 400 })

    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Only a member of the gig's organization can read its proposals.
    const gig = await prisma.gig.findUnique({ where: { id: gigId }, select: { orgId: true } })
    if (!gig) return NextResponse.json({ error: 'Gig not found' }, { status: 404 })
    const member = await prisma.userOrgRole.findFirst({
      where: { userId: session.user.id, orgId: gig.orgId, deletedAt: null },
      select: { orgId: true },
    })
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const proposals = await prisma.gigProposal.findMany({
      where: { gigId },
      include: {
        freelancer: {
          select: {
            id: true,
            title: true,
            location: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
      // Proposals are bounded by the gig (and the gig by tenancy); `take` is a
      // safety net, with an `id` tiebreaker for a deterministic order.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
    })
    return NextResponse.json({ proposals })
  },
  { preset: 'api' },
)

const proposalSchema = z.object({
  proposedRate: z.number().int().min(0).max(10000000).nullable().optional(),
  proposedDurationDays: z.number().int().min(1).max(3650).nullable().optional(),
  message: z.string().max(4000).optional(),
})

export const POST = withCsrfProtection(
  withRateLimit(
    async (request: Request, context?: { params?: Record<string, string> }) => {
      try {
        const gigId = context?.params?.id
        if (!gigId) return NextResponse.json({ error: 'Missing gig id' }, { status: 400 })

        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const freelancer = await prisma.freelancerProfile.findUnique({
          where: { userId: session.user.id },
          select: { id: true },
        })
        if (!freelancer) {
          return NextResponse.json(
            { error: 'Only freelancers can send proposals' },
            { status: 403 },
          )
        }

        const gig = await prisma.gig.findFirst({
          where: { id: gigId, organization: { deletedAt: null } },
          select: { status: true },
        })
        if (!gig) return NextResponse.json({ error: 'Gig not found' }, { status: 404 })
        if (gig.status !== 'OPEN') {
          return NextResponse.json({ error: 'Táto zákazka už neprijíma ponuky' }, { status: 400 })
        }

        const parsed = proposalSchema.safeParse(await request.json())
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Invalid data', details: parsed.error.errors },
            { status: 400 },
          )
        }

        // One proposal per (gig, freelancer). Re-submitting edits a PENDING or WITHDRAWN one;
        // an ACCEPTED or REJECTED proposal is final and must not jump back into the queue.
        const fields = {
          proposedRate: parsed.data.proposedRate ?? null,
          proposedDurationDays: parsed.data.proposedDurationDays ?? null,
          message: parsed.data.message,
        }
        const existing = await prisma.gigProposal.findUnique({
          where: { gigId_freelancerId: { gigId, freelancerId: freelancer.id } },
          select: { id: true },
        })
        let proposal
        if (existing) {
          const updated = await prisma.gigProposal.updateMany({
            where: { id: existing.id, status: { in: ['PENDING', 'WITHDRAWN'] } },
            data: { ...fields, status: 'PENDING' },
          })
          if (updated.count === 0) {
            return NextResponse.json(
              { error: 'This proposal has already been decided' },
              { status: 409 },
            )
          }
          proposal = await prisma.gigProposal.findUnique({ where: { id: existing.id } })
        } else {
          proposal = await prisma.gigProposal.create({
            data: { gigId, freelancerId: freelancer.id, ...fields },
          })
        }
        return NextResponse.json({ proposal }, { status: 201 })
      } catch (error) {
        logger.error('Create proposal error', { error })
        return NextResponse.json({ error: 'Failed to send proposal' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)
