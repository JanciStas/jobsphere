/**
 * Single gig (company view): read, edit / change status, delete.
 * Everything is scoped to the caller's own organizations; a gig of another
 * org answers 404 (not 403) so ids cannot be probed.
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'
import { logger } from '@/lib/logger'
import { getMemberOrgIds } from '../_lib/org-scope'

type Ctx = { params?: Record<string, string> }

const updateSchema = z
  .object({
    title: z.string().min(1).max(150).optional(),
    description: z.string().min(1).max(8000).optional(),
    budget: z.number().int().min(0).max(10000000).nullable().optional(),
    durationDays: z.number().int().min(1).max(3650).nullable().optional(),
    currency: z.string().min(1).max(8).optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'CLOSED']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' })

const notFound = () => NextResponse.json({ error: 'Gig not found' }, { status: 404 })

export const GET = withRateLimit(
  async (_req: Request, context?: Ctx) => {
    const gigId = context?.params?.id
    if (!gigId) return NextResponse.json({ error: 'Missing gig id' }, { status: 400 })
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const orgIds = await getMemberOrgIds(session.user.id)
    const gig = await prisma.gig.findFirst({
      where: { id: gigId, orgId: { in: orgIds } },
      include: { _count: { select: { proposals: true } } },
    })
    if (!gig) return notFound()
    return NextResponse.json({ gig })
  },
  { preset: 'api' },
)

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (request: Request, context?: Ctx) => {
      try {
        const gigId = context?.params?.id
        if (!gigId) return NextResponse.json({ error: 'Missing gig id' }, { status: 400 })
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const parsed = updateSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Invalid data', details: parsed.error.errors },
            { status: 400 },
          )
        }

        const orgIds = await getMemberOrgIds(session.user.id)
        if (orgIds.length === 0) return notFound()

        const result = await prisma.gig.updateMany({
          where: { id: gigId, orgId: { in: orgIds } },
          data: parsed.data,
        })
        if (result.count === 0) return notFound()
        return NextResponse.json({ ok: true })
      } catch (error) {
        logger.error('Update gig error', { error })
        return NextResponse.json({ error: 'Failed to update gig' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)

export const DELETE = withCsrfProtection(
  withRateLimit(
    async (_request: Request, context?: Ctx) => {
      try {
        const gigId = context?.params?.id
        if (!gigId) return NextResponse.json({ error: 'Missing gig id' }, { status: 400 })
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const orgIds = await getMemberOrgIds(session.user.id)
        if (orgIds.length === 0) return notFound()

        // Proposals are removed by the onDelete: Cascade relation.
        const result = await prisma.gig.deleteMany({
          where: { id: gigId, orgId: { in: orgIds } },
        })
        if (result.count === 0) return notFound()
        return NextResponse.json({ ok: true })
      } catch (error) {
        logger.error('Delete gig error', { error })
        return NextResponse.json({ error: 'Failed to delete gig' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)
