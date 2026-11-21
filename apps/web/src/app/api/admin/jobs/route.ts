import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin-guard'
import { parseLimit, parsePageNumber } from '@/lib/admin/paging'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { canTransition } from '@/lib/job-status'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { handleApiError } from '@/lib/errors'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

async function listJobs(req: Request) {
  try {
    const guard = await requireAdminApi()
    if (!guard.ok) return guard.response

    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search') ?? undefined
    const status = searchParams.get('status') ?? undefined
    const page = parsePageNumber(searchParams.get('page'))
    const limit = parseLimit(searchParams.get('limit'), 50)
    const skip = (page - 1) * limit

    const where = {
      // Opt-in to soft-deleted rows only (explicit deletedAt overrides the middleware).
      ...(searchParams.get('deleted') === '1' ? { deletedAt: { not: null } } : {}),
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' as const } },
              { organization: { name: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        select: {
          id: true,
          title: true,
          status: true,
          orgId: true,
          createdAt: true,
          organization: { select: { name: true } },
          _count: { select: { applications: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.job.count({ where }),
    ])

    return NextResponse.json({ jobs, total, page, limit })
  } catch (error) {
    logger.error('Admin GET /jobs error:', error)
    return handleApiError(error)
  }
}

// Same vocabularies as createJobSchema below, so an edit cannot store a value the public
// filters do not know (which would silently hide the job from every filtered listing).
const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'FREELANCE', 'INTERNSHIP'] as const
const SENIORITIES = ['JUNIOR', 'MID', 'SENIOR', 'LEAD', 'EXECUTIVE'] as const

/** Content keys whose before/after values go into the audit entry. */
const CONTENT_KEYS = [
  'title',
  'description',
  'requirements',
  'benefits',
  'city',
  'region',
  'salaryMin',
  'salaryMax',
  'salaryCurrency',
  'employmentType',
  'seniority',
] as const

const salaryOrdered = (d: { salaryMin?: number | null; salaryMax?: number | null }) =>
  d.salaryMin == null || d.salaryMax == null || d.salaryMin <= d.salaryMax

const patchSchema = z.object({
  jobId: z.string().min(1),
  // PAUSED was missing here while job-status-filter.tsx offered it as a filter,
  // so an admin could search for paused jobs and then had no way to change one.
  status: z.enum(['DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED']).optional(),
  // Job.deletedAt has always existed and admin had no way to set it: a posting
  // could be closed but never removed from the platform.
  deleted: z.boolean().optional(),
  // Content, so an admin can fix a posting rather than only close it. Mirrors
  // updateJobSchema in api/jobs/[id]; the two stay comparable on purpose.
  title: z.string().min(3).max(200).optional(),
  description: z.string().min(50).max(10000).optional(),
  requirements: z.string().max(10000).optional().nullable(),
  benefits: z.string().max(10000).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  region: z.string().max(100).optional().nullable(),
  salaryMin: z.number().int().min(0).optional().nullable(),
  salaryMax: z.number().int().min(0).optional().nullable(),
  salaryCurrency: z.string().max(10).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  seniority: z.enum(SENIORITIES).optional(),
})

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      try {
        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response
        const session = guard.session

        const parsed = patchSchema.safeParse(await req.json().catch(() => null))
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Validation failed', issues: parsed.error.issues },
            { status: 400 },
          )
        }
        const { jobId, status, deleted, ...content } = parsed.data

        if (status === undefined && deleted === undefined && Object.keys(content).length === 0) {
          return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
        }

        const job = await prisma.job.findUnique({ where: { id: jobId } })
        if (!job) {
          return NextResponse.json({ error: 'Job not found' }, { status: 404 })
        }

        // Checked against the merged result, so lowering only one bound is validated too.
        if (
          !salaryOrdered({
            salaryMin: content.salaryMin !== undefined ? content.salaryMin : job.salaryMin,
            salaryMax: content.salaryMax !== undefined ? content.salaryMax : job.salaryMax,
          })
        ) {
          return NextResponse.json(
            { error: 'salaryMin must not exceed salaryMax' },
            { status: 400 },
          )
        }

        // Same transition table the employer-side route validates against, rather
        // than a second copy that can drift from it.
        if (status && !canTransition(job.status, status)) {
          return NextResponse.json(
            { error: 'Invalid status transition', from: job.status, to: status },
            { status: 400 },
          )
        }

        const updated = await prisma.job.update({
          where: { id: jobId },
          data: {
            ...content,
            ...(status !== undefined && { status }),
            // Deleting also closes it: a soft-deleted posting that still says
            // PUBLISHED is a contradiction waiting to confuse whoever reads the
            // row next.
            ...(deleted !== undefined && {
              deletedAt: deleted ? new Date() : null,
              ...(deleted && { status: 'CLOSED' }),
            }),
          },
          select: { id: true, title: true, status: true, deletedAt: true },
        })

        logger.info(`Admin updated job ${jobId} by ${session.user.id}`, { status, deleted })

        // Content edits are recorded with before/after values; otherwise a content-only edit
        // would leave an audit entry that shows no change at all.
        const changedKeys = CONTENT_KEYS.filter((k) => content[k] !== undefined)
        const jobRow = job as unknown as Record<string, unknown>
        const contentBefore = Object.fromEntries(changedKeys.map((k) => [k, jobRow[k] ?? null]))
        const contentAfter = Object.fromEntries(changedKeys.map((k) => [k, content[k] ?? null]))

        await createAuditLog({
          userId: session.user.id,
          orgId: job.orgId,
          action: 'JOB_UPDATED',
          resource: 'JOB',
          resourceId: jobId,
          previous: {
            status: job.status,
            deletedAt: job.deletedAt?.toISOString() ?? null,
            ...contentBefore,
          },
          metadata: {
            status: updated.status,
            deletedAt: updated.deletedAt?.toISOString() ?? null,
            ...contentAfter,
            ...(changedKeys.length ? { changedFields: changedKeys } : {}),
          },
          ...getRequestMetadata(req),
        })

        return NextResponse.json({ job: updated })
      } catch (error) {
        logger.error('Admin PATCH /jobs error:', error)
        return handleApiError(error)
      }
    },
    { preset: 'api' },
  ),
)

// Admin job creation. Unlike POST /api/jobs (which resolves the org from the
// caller's membership), a global admin is not bound to any org — so `orgId` is
// REQUIRED in the body and validated to exist before the job is created.
const createJobSchema = z
  .object({
    orgId: z.string().min(1, 'orgId is required'),
    title: z.string().min(3, 'Title must be at least 3 characters').max(200),
    description: z.string().min(50, 'Description must be at least 50 characters').max(10000),
    requirements: z.string().max(10000).optional(),
    benefits: z.string().max(10000).optional(),
    location: z.string().min(2).max(100).optional(),
    region: z.string().max(100).optional(),
    workMode: z.enum(['REMOTE', 'HYBRID', 'ONSITE']).default('ONSITE'),
    type: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
    seniority: z.enum(SENIORITIES).default('MID'),
    salaryMin: z.number().int().min(0).optional(),
    salaryMax: z.number().int().min(0).optional(),
    salaryCurrency: z.string().max(10).optional(),
    status: z.enum(['DRAFT', 'PUBLISHED', 'CLOSED']).default('PUBLISHED'),
  })
  .refine(salaryOrdered, { message: 'salaryMin must not exceed salaryMax', path: ['salaryMin'] })

export const POST = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      try {
        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response
        const session = guard.session

        const body = await req.json().catch(() => null)
        const data = createJobSchema.parse(body)

        // The chosen org must exist (and not be soft-deleted) — otherwise the
        // Job.orgId FK would dangle / point at a suspended org.
        const org = await prisma.organization.findFirst({
          where: { id: data.orgId, deletedAt: null },
          select: { id: true },
        })
        if (!org) {
          return NextResponse.json(
            { error: 'Organization not found or suspended' },
            { status: 404 },
          )
        }

        const job = await prisma.job.create({
          data: {
            title: data.title,
            description: data.description,
            requirements: data.requirements || null,
            benefits: data.benefits || null,
            city: data.location || null,
            region: data.region || null,
            remote: data.workMode === 'REMOTE',
            hybrid: data.workMode === 'HYBRID',
            salaryMin: data.salaryMin ?? null,
            salaryMax: data.salaryMax ?? null,
            salaryCurrency: data.salaryCurrency || 'EUR',
            employmentType: data.type,
            seniority: data.seniority,
            status: data.status,
            publishedAt: data.status === 'PUBLISHED' ? new Date() : null,
            orgId: org.id,
            // Provenance: the admin who created it (session.user.id is guaranteed
            // present because requireAdminApi resolved a global-admin session).
            createdBy: session.user.id,
          },
          select: { id: true, title: true, status: true, orgId: true, createdAt: true },
        })

        logger.info(`Admin created job ${job.id} for org ${org.id} by ${session.user.id}`)

        await createAuditLog({
          userId: session.user.id,
          orgId: org.id,
          action: 'JOB_CREATED',
          resource: 'JOB',
          resourceId: job.id,
          metadata: { title: job.title, status: job.status },
          ...getRequestMetadata(req),
        })
        return NextResponse.json({ job }, { status: 201 })
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'Validation failed', issues: error.issues },
            { status: 400 },
          )
        }
        logger.error('Admin POST /jobs error:', error)
        return handleApiError(error)
      }
    },
    { preset: 'api' },
  ),
)

// Rate limiting was missing on this handler until the route wrapper contract
// test (tests/security/route-wrapper-contract.test.ts) enumerated the API surface.
export const GET = withRateLimit(listJobs, { preset: 'api', byUser: true })
