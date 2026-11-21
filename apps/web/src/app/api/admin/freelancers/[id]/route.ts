import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/errors'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { requireAdminApi } from '@/lib/admin-guard'
import { AVAILABILITIES, httpUrl } from '@/lib/admin-marketplace'
import { listPortfolioItems } from '@/lib/portfolio-safe'

export const runtime = 'nodejs'

const PROFILE_SELECT = {
  id: true,
  title: true,
  bio: true,
  services: true,
  skills: true,
  hourlyRate: true,
  currency: true,
  availability: true,
  location: true,
  portfolioUrl: true,
  visible: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, name: true, email: true } },
} as const

async function detail(_req: Request, context?: { params?: Record<string, string> }) {
  try {
    const guard = await requireAdminApi()
    if (!guard.ok) return guard.response
    const id = context?.params?.id
    if (!id) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

    const profile = await prisma.freelancerProfile.findUnique({
      where: { id },
      select: PROFILE_SELECT,
    })
    if (!profile) return NextResponse.json({ error: 'Freelancer not found' }, { status: 404 })

    const [portfolio, proposals] = await Promise.all([
      listPortfolioItems(id),
      prisma.gigProposal.findMany({
        where: { freelancerId: id },
        select: {
          id: true,
          status: true,
          proposedRate: true,
          createdAt: true,
          gig: { select: { id: true, title: true, orgId: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ])
    return NextResponse.json({ profile, portfolio, proposals })
  } catch (error) {
    logger.error('Admin GET /freelancers/[id] error:', error)
    return handleApiError(error)
  }
}

const strList = z.array(z.string().trim().min(1).max(80)).max(30)

const patchSchema = z
  .object({
    title: z.string().trim().max(120).nullable().optional(),
    bio: z.string().trim().max(5000).nullable().optional(),
    services: strList.optional(),
    skills: strList.optional(),
    hourlyRate: z.number().int().min(0).max(100000).nullable().optional(),
    availability: z.enum(AVAILABILITIES).optional(),
    location: z.string().trim().max(120).nullable().optional(),
    portfolioUrl: httpUrl.nullable().optional(),
    visible: z.boolean().optional(),
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

        const before = await prisma.freelancerProfile.findUnique({
          where: { id },
          select: PROFILE_SELECT,
        })
        if (!before) return NextResponse.json({ error: 'Freelancer not found' }, { status: 404 })

        const updated = await prisma.freelancerProfile.update({
          where: { id },
          data,
          select: PROFILE_SELECT,
        })

        const pick = (o: object) =>
          Object.fromEntries(changed.map((k) => [k, (o as Record<string, unknown>)[k] ?? null]))
        await createAuditLog({
          userId: guard.session.user.id,
          action: 'UPDATE',
          resource: 'FREELANCER',
          resourceId: id,
          previous: pick(before) as never,
          metadata: pick(updated) as never,
          ...getRequestMetadata(req),
        })
        logger.info(`Admin updated freelancer ${id} by ${guard.session.user.id}`)
        return NextResponse.json({ profile: updated })
      } catch (error) {
        logger.error('Admin PATCH /freelancers/[id] error:', error)
        return handleApiError(error)
      }
    },
    { preset: 'api' },
  ),
)

export const GET = withRateLimit(detail, { preset: 'api', byUser: true })
