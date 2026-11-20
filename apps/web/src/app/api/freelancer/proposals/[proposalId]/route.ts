/**
 * Freelancer withdraws their own PENDING proposal.
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'
import { z } from 'zod'
import { logger } from '@/lib/logger'

const schema = z.object({ action: z.literal('WITHDRAW') })

const NOT_PENDING = { error: 'Only pending proposals can be withdrawn' }

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (request: Request, context?: { params?: Record<string, string> }) => {
      try {
        const proposalId = context?.params?.proposalId
        if (!proposalId) return NextResponse.json({ error: 'Missing proposal id' }, { status: 400 })

        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const parsed = schema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 })

        const proposal = await prisma.gigProposal.findFirst({
          where: { id: proposalId, freelancer: { userId: session.user.id } },
          select: { id: true, status: true },
        })
        if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        if (proposal.status !== 'PENDING') return NextResponse.json(NOT_PENDING, { status: 409 })

        // Status guard in the write itself avoids racing with a company decision.
        const res = await prisma.gigProposal.updateMany({
          where: { id: proposalId, status: 'PENDING' },
          data: { status: 'WITHDRAWN' },
        })
        if (res.count === 0) return NextResponse.json(NOT_PENDING, { status: 409 })
        return NextResponse.json({ ok: true, status: 'WITHDRAWN' })
      } catch (error) {
        logger.error('Proposal withdraw error', { error })
        return NextResponse.json({ error: 'Failed to withdraw proposal' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)
