import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/errors'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { requireAdminApi } from '@/lib/admin-guard'
import { GIG_STATUSES } from '@/lib/admin-marketplace'

export const runtime = 'nodejs'

const GIG_SELECT = {
  id: true,
  orgId: true,
  title: true,
  description: true,
  budget: true,
  currency: true,
  durationDays: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  organization: { select: { id: true, name: true } },
} as const

async function detail(_req: Request, context?: { params?: Record<string, string> }) {
  try {
    const guard = await requireAdminApi()
    if (!guard.ok) return guard.response
    const id = context?.params?.id
    if (!id) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

    const gig = await prisma.gig.findUnique({
      where: { id },
      select: {
        ...GIG_SELECT,
        proposals: {
          select: {
            id: true,
            status: true,
            proposedRate: true,
            proposedDurationDays: true,
            message: true,
            createdAt: true,
            freelancer: {
              select: { id: true, title: true, user: { select: { name: true, email: true } } },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
      },
    })
    if (!gig) return NextResponse.json({ error: 'Gig not found' }, { status: 404 })
    return NextResponse.json({ gig })
  } catch (error) {
    logger.error('Admin GET /gigs/[id] error:', error)
    return handleApiError(error)
  }
}

const patchSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().min(10).max(10000).optional(),
    budget: z.number().int().min(0).max(100000000).nullable().optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    durationDays: z.number().int().min(1).max(3650).nullable().optional(),
    status: z.enum(GIG_STATUSES).optional(),
  })
  .strict()

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      try {
        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response
        const id = context?.params?.id
        if (!id) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

        const data = patchSchema.parse(await req.json().catch(() => null))
        const changed = Object.keys(data)
        if (changed.length === 0) {
          return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
        }

        const before = await prisma.gig.findUnique({ where: { id }, select: GIG_SELECT })
        if (!before) return NextResponse.json({ error: 'Gig not found' }, { status: 404 })

        const updated = await prisma.gig.update({ where: { id }, data, select: GIG_SELECT })

        const pick = (o: object) =>
          Object.fromEntries(changed.map((k) => [k, (o as Record<string, unknown>)[k] ?? null]))
        await createAuditLog({
          userId: guard.session.user.id,
          orgId: before.orgId,
          action: 'UPDATE',
          resource: 'GIG',
          resourceId: id,
          previous: pick(before) as never,
          metadata: pick(updated) as never,
          ...getRequestMetadata(req),
        })
        logger.info(`Admin updated gig ${id} by ${guard.session.user.id}`)
        return NextResponse.json({ gig: updated })
      } catch (error) {
        logger.error('Admin PATCH /gigs/[id] error:', error)
        return handleApiError(error)
      }
    },
    { preset: 'api' },
  ),
)

/**
 * Hard delete (Gig has no deletedAt); proposals cascade. The pre-image is kept
 * in the audit log so the removal stays reconstructable.
 */
export const DELETE = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      try {
        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response
        const id = context?.params?.id
        if (!id) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

        const before = await prisma.gig.findUnique({
          where: { id },
          select: { ...GIG_SELECT, _count: { select: { proposals: true } } },
        })
        if (!before) return NextResponse.json({ error: 'Gig not found' }, { status: 404 })

        await prisma.gig.delete({ where: { id } })

        await createAuditLog({
          userId: guard.session.user.id,
          orgId: before.orgId,
          action: 'DELETE',
          resource: 'GIG',
          resourceId: id,
          previous: {
            title: before.title,
            status: before.status,
            budget: before.budget,
            currency: before.currency,
            proposals: before._count.proposals,
          },
          ...getRequestMetadata(req),
        })
        logger.info(`Admin deleted gig ${id} by ${guard.session.user.id}`)
        return NextResponse.json({ success: true })
      } catch (error) {
        logger.error('Admin DELETE /gigs/[id] error:', error)
        return handleApiError(error)
      }
    },
    { preset: 'api' },
  ),
)

export const GET = withRateLimit(detail, { preset: 'api', byUser: true })
