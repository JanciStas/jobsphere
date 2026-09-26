import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveActiveMembership } from '@/lib/api-helpers'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { z } from 'zod'

export const runtime = 'nodejs'

// name is the only required field; everything else is an optional address part.
const createBranchSchema = z.object({
  name: z.string().trim().min(1).max(200),
  street: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  region: z.string().trim().max(120).optional().nullable(),
  country: z.string().trim().max(120).optional().nullable(),
  postalCode: z.string().trim().max(40).optional().nullable(),
  isPrimary: z.boolean().optional(),
})

export const GET = withRateLimit(
  async function GET() {
    try {
      const session = await auth()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Org is derived from the caller's membership — never from the request.
      const userOrgRole = await resolveActiveMembership(session.user.id, session.user.activeOrgId)
      if (!userOrgRole) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
      }

      // Branches are bounded by tenancy (a handful per org); `take` is a safety net,
      // and the `id` tiebreaker makes the order fully deterministic.
      const branches = await prisma.branch.findMany({
        where: { orgId: userOrgRole.orgId, deletedAt: null },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: 500,
      })

      return NextResponse.json({ branches })
    } catch (error) {
      logger.error('Error fetching branches:', error)
      return NextResponse.json({ error: 'Failed to fetch branches' }, { status: 500 })
    }
  },
  { preset: 'api', byUser: true },
)

export const POST = withCsrfProtection(
  withRateLimit(
    async function POST(request: Request) {
      try {
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const userOrgRole = await resolveActiveMembership(session.user.id, session.user.activeOrgId)
        if (!userOrgRole) {
          return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
        }

        const body = await request.json()
        const data = createBranchSchema.parse(body)
        const orgId = userOrgRole.orgId

        // Creating a primary branch must demote every other branch in the org so
        // there is never more than one primary — do it atomically.
        const branch = await prisma.$transaction(async (tx) => {
          if (data.isPrimary) {
            await tx.branch.updateMany({
              where: { orgId, isPrimary: true, deletedAt: null },
              data: { isPrimary: false },
            })
          }
          return tx.branch.create({
            data: {
              orgId,
              name: data.name,
              street: data.street ?? null,
              city: data.city ?? null,
              region: data.region ?? null,
              country: data.country ?? null,
              postalCode: data.postalCode ?? null,
              isPrimary: data.isPrimary ?? false,
            },
          })
        })

        return NextResponse.json({ branch }, { status: 201 })
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'Invalid request data', details: error.errors },
            { status: 400 },
          )
        }
        logger.error('Error creating branch:', error)
        return NextResponse.json({ error: 'Failed to create branch' }, { status: 500 })
      }
    },
    { preset: 'api', byUser: true },
  ),
)
