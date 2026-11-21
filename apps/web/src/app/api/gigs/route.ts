/**
 * Gigs API — companies post freelance gigs (POST) and list their own (GET).
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveGigOrgId } from './_lib/org-scope'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'
import { z } from 'zod'
import { logger } from '@/lib/logger'

// List the current org's gigs (employer view) with proposal counts.
export const GET = withRateLimit(
  async () => {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const orgId = await resolveGigOrgId(session.user.id, session.user.orgId)
    if (!orgId) {
      return NextResponse.json({ gigs: [] })
    }
    const gigs = await prisma.gig.findMany({
      where: { orgId },
      include: { _count: { select: { proposals: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return NextResponse.json({ gigs })
  },
  { preset: 'api' },
)

const createSchema = z.object({
  title: z.string().min(1).max(150),
  description: z.string().min(1).max(8000),
  budget: z.number().int().min(0).max(10000000).nullable().optional(),
  durationDays: z.number().int().min(1).max(3650).nullable().optional(),
  currency: z.string().max(8).optional(),
})

export const POST = withCsrfProtection(
  withRateLimit(
    async (request: Request) => {
      try {
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const orgId = await resolveGigOrgId(session.user.id, session.user.orgId)
        if (!orgId) {
          return NextResponse.json({ error: 'Only company members can post gigs' }, { status: 403 })
        }

        const parsed = createSchema.safeParse(await request.json())
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Invalid data', details: parsed.error.errors },
            { status: 400 },
          )
        }

        const gig = await prisma.gig.create({
          data: {
            orgId,
            createdBy: session.user.id,
            title: parsed.data.title,
            description: parsed.data.description,
            budget: parsed.data.budget ?? null,
            durationDays: parsed.data.durationDays ?? null,
            currency: parsed.data.currency || 'EUR',
          },
        })
        return NextResponse.json({ gig }, { status: 201 })
      } catch (error) {
        logger.error('Create gig error', { error })
        return NextResponse.json({ error: 'Failed to create gig' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)
