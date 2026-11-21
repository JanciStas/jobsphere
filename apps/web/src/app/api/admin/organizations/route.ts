import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { handleApiError } from '@/lib/errors'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { generateUniqueOrgSlug } from '@/lib/org-slug'

export const runtime = 'nodejs'

async function listOrganizations() {
  try {
    const guard = await requireAdminApi()
    if (!guard.ok) return guard.response

    const orgs = await prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        industry: true,
        createdAt: true,
        deletedAt: true,
        _count: {
          select: {
            users: true,
            jobs: true,
            subscriptions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return NextResponse.json({ organizations: orgs })
  } catch (error) {
    logger.error('Admin GET /organizations error:', error)
    return handleApiError(error)
  }
}

/**
 * `suspend` and `activate` toggle Organization.deletedAt, which is also what the
 * soft-delete middleware in lib/prisma.ts reads. That looks like two concepts
 * sharing a column, and splitting them into a separate `suspendedAt` was
 * considered — but the sharing is load-bearing: because Organization is one of
 * the five models the middleware covers, suspension hides the organisation from
 * every findFirst/findMany/count in the app for free. A separate column could
 * not be applied by the middleware, so all ~19 organisation reads would have to
 * remember `suspendedAt: null` and any one that forgot would silently expose a
 * suspended tenant. Left as one column, named honestly here instead.
 *
 * `update` is new: an organisation could be created and suspended but never
 * edited — not its name, industry, size or website, through any route or screen.
 * Slug is deliberately absent: it is in public URLs, and renaming it would break
 * every existing link to the company profile.
 */
const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('suspend'),
    orgId: z.string().min(1),
  }),
  z.object({
    action: z.literal('activate'),
    orgId: z.string().min(1),
  }),
  z.object({
    action: z.literal('update'),
    orgId: z.string().min(1),
    name: z.string().min(1).max(200).optional(),
    industry: z.string().max(100).optional().nullable(),
    size: z.string().max(50).optional().nullable(),
    website: z.string().url().max(300).optional().nullable(),
  }),
])

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      try {
        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response
        const session = guard.session

        const body = await req.json().catch(() => null)
        const parsed = patchSchema.parse(body)
        const { orgId, action } = parsed

        const org = await prisma.organization.findUnique({ where: { id: orgId } })
        if (!org) {
          return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
        }

        if (action === 'update') {
          const updated = await prisma.organization.update({
            where: { id: orgId },
            data: {
              ...(parsed.name !== undefined && { name: parsed.name }),
              ...(parsed.industry !== undefined && { industry: parsed.industry }),
              ...(parsed.size !== undefined && { size: parsed.size }),
              ...(parsed.website !== undefined && { website: parsed.website }),
            },
            select: { id: true, name: true, industry: true, size: true, website: true },
          })

          logger.info(`Admin updated organization ${orgId} by ${session.user.id}`)

          await createAuditLog({
            userId: session.user.id,
            orgId,
            action: 'UPDATE',
            resource: 'ORGANIZATION',
            resourceId: orgId,
            previous: {
              name: org.name,
              industry: org.industry,
              size: org.size,
              website: org.website,
            },
            metadata: updated,
            ...getRequestMetadata(req),
          })

          return NextResponse.json({ organization: updated })
        }

        const suspending = action === 'suspend'

        const updated = await prisma.organization.update({
          where: { id: orgId },
          data: { deletedAt: suspending ? new Date() : null },
          select: { id: true, name: true, deletedAt: true },
        })

        // Suspending the organisation without this leaves every member holding a
        // working session: they keep browsing an organisation the platform
        // considers gone until their JWT expires on its own.
        if (suspending) {
          await prisma.user.updateMany({
            where: { organizations: { some: { orgId } } },
            data: { sessionEpoch: { increment: 1 } },
          })
        }

        logger.info(`Admin ${action} organization ${orgId} by ${session.user.id}`)

        await createAuditLog({
          userId: session.user.id,
          orgId,
          action: action === 'suspend' ? 'SUSPEND' : 'ACTIVATE',
          resource: 'ORGANIZATION',
          resourceId: orgId,
          previous: { deletedAt: action === 'suspend' ? null : 'set' },
          metadata: { deletedAt: updated.deletedAt?.toISOString() ?? null },
          ...getRequestMetadata(req),
        })
        return NextResponse.json({ organization: updated })
      } catch (error) {
        logger.error('Admin PATCH /organizations error:', error)
        return handleApiError(error)
      }
    },
    { preset: 'api' },
  ),
)

const createOrgSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  slug: z
    .string()
    .max(100)
    .regex(/^[a-z0-9-]+$/, 'Slug may only contain lowercase letters, numbers and hyphens')
    .optional(),
  industry: z.string().max(100).optional(),
  size: z.string().max(50).optional(),
  website: z.string().url('Website must be a valid URL').max(300).optional(),
})

export const POST = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      try {
        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response
        const session = guard.session

        const body = await req.json().catch(() => null)
        const data = createOrgSchema.parse(body)

        // Prefer an explicit slug when supplied, otherwise derive one from name.
        // Either way run it through the uniqueness probe so we never violate the
        // Organization.slug unique constraint.
        const slug = await generateUniqueOrgSlug(data.slug || data.name)

        const org = await prisma.organization.create({
          data: {
            name: data.name.trim(),
            slug,
            industry: data.industry || null,
            size: data.size || null,
            website: data.website || null,
          },
          select: { id: true, name: true, slug: true, industry: true, createdAt: true },
        })

        logger.info(`Admin created organization ${org.id} by ${session.user.id}`)

        await createAuditLog({
          userId: session.user.id,
          orgId: org.id,
          action: 'CREATE',
          resource: 'ORGANIZATION',
          resourceId: org.id,
          metadata: { name: org.name, slug: org.slug },
          ...getRequestMetadata(req),
        })
        return NextResponse.json({ organization: org }, { status: 201 })
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'Validation failed', issues: error.issues },
            { status: 400 },
          )
        }
        logger.error('Admin POST /organizations error:', error)
        return handleApiError(error)
      }
    },
    { preset: 'api' },
  ),
)

// Rate limiting was missing on this handler until the route wrapper contract
// test (tests/security/route-wrapper-contract.test.ts) enumerated the API surface.
export const GET = withRateLimit(listOrganizations, { preset: 'api', byUser: true })
