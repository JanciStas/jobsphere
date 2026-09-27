import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { JOB_STATUSES, canTransition, shouldStampPublishedAt } from '@/lib/job-status'
import { errorResponse } from '@/lib/errors'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'
import { requireAuth } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

export const runtime = 'nodejs'

const updateJobSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().min(50).max(10000).optional(),
  requirements: z.string().max(10000).optional().nullable(),
  benefits: z.string().max(10000).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  salaryMin: z.number().int().min(0).optional().nullable(),
  salaryMax: z.number().int().min(0).optional().nullable(),
  salaryCurrency: z.string().max(10).optional(),
  remote: z.boolean().optional(),
  hybrid: z.boolean().optional(),
  employmentType: z.string().optional(),
  seniority: z.string().optional(),
  region: z.string().max(100).optional().nullable(),

  // Everything below was accepted by POST /api/jobs and silently dropped here:
  // zod without .strict() discards unknown keys, so a job created with an
  // assessment and an assigned recruiter lost both the first time anyone saved
  // an edit — and `status` being absent is why a posting could not be paused or
  // reopened through the API at all.
  status: z.enum(JOB_STATUSES).optional(),
  department: z.string().max(100).optional().nullable(),
  keywords: z.array(z.string().max(50)).max(50).optional(),
  imageUrl: z.string().url().max(500).optional().nullable(),
  videoUrl: z.string().url().max(500).optional().nullable(),
  requiresAssessment: z.boolean().optional(),
  assessmentId: z.string().optional().nullable(),
  screeningQuestions: z.any().optional(),
  assignedRecruiterId: z.string().optional().nullable(),
})

export const GET = withRateLimit(
  async (req: Request, context?: { params?: Record<string, string> }) => {
    const startTime = Date.now()

    try {
      const params = context?.params
      if (!params?.id) {
        return NextResponse.json({ error: 'Missing job ID' }, { status: 400 })
      }

      logger.apiRequest('GET', `/api/jobs/${params.id}`)

      // Autentifikovaní používatelia (zamestnávatelia) môžu vidieť aj DRAFT/PAUSED joby svojej org
      const session = await requireAuth().catch(() => null)
      const orgId = session?.user?.orgId

      const job = await prisma.job.findUnique({
        where: { id: params.id },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              logo: true,
              description: true,
              website: true,
            },
          },
          _count: {
            select: {
              applications: true,
            },
          },
        },
      })

      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      // Verejní používatelia vidia len PUBLISHED joby
      const isOwner = orgId && job.orgId === orgId
      if (job.status !== 'PUBLISHED' && !isOwner) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }

      const duration = Date.now() - startTime
      logger.info(`Fetched job ${params.id}`, { duration })

      return NextResponse.json(job)
    } catch (error) {
      logger.apiError('GET', `/api/jobs/[id]`, error)
      const errorData = errorResponse(error)
      return NextResponse.json({ error: errorData.error }, { status: errorData.statusCode })
    }
  },
  { preset: 'public' }, // 200 requests per minute
)

// Update job (for employers)
export const PUT = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      try {
        const params = context?.params
        if (!params?.id) {
          return NextResponse.json({ error: 'Missing job ID' }, { status: 400 })
        }

        logger.apiRequest('PUT', `/api/jobs/${params.id}`)

        const session = await requireAuth()

        if (!session.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Check if user owns the job through organization
        // findFirst, not findUnique: the soft-delete middleware in lib/prisma.ts
        // only augments findFirst/findMany/count, so findUnique returned
        // soft-deleted jobs and left them mutable.
        const job = await prisma.job.findFirst({
          where: { id: params.id },
          include: {
            organization: {
              include: {
                // Nested includes bypass the soft-delete middleware, so a removed
                // member must be excluded by hand.
                users: {
                  where: { userId: session.user.id, deletedAt: null },
                },
              },
            },
          },
        })

        if (!job || job.organization.users.length === 0) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        // AUTH-006: only admins and recruiters may modify jobs
        const memberRole = job.organization.users[0].role
        if (!['ORG_ADMIN', 'RECRUITER'].includes(memberRole)) {
          return NextResponse.json(
            { error: 'You do not have permission to update jobs' },
            { status: 403 },
          )
        }

        // Validate and update job
        const rawData = await req.json()
        const data = updateJobSchema.parse(rawData)

        if (data.status && !canTransition(job.status, data.status)) {
          return NextResponse.json(
            { error: 'Invalid status transition', from: job.status, to: data.status },
            { status: 400 },
          )
        }

        // Same cross-tenant guards POST /api/jobs applies: a foreign assessment or an
        // outside user must never be attached through an edit (IDOR).
        if (data.assessmentId) {
          const assessment = await prisma.assessment.findFirst({
            where: { id: data.assessmentId, orgId: job.orgId, deletedAt: null },
            select: { id: true },
          })
          if (!assessment) {
            return NextResponse.json(
              { error: 'Selected assessment was not found in your organization' },
              { status: 400 },
            )
          }
        }
        if (data.assignedRecruiterId) {
          const recruiter = await prisma.userOrgRole.findFirst({
            where: { userId: data.assignedRecruiterId, orgId: job.orgId, deletedAt: null },
            select: { userId: true },
          })
          if (!recruiter) {
            return NextResponse.json(
              { error: 'Assigned recruiter must be a member of your organization' },
              { status: 400 },
            )
          }
        }

        const updated = await prisma.job.update({
          where: { id: params.id },
          data: {
            ...data,
            // Stamped once, on the first publish only. Re-stamping on every
            // resume would keep resetting the posting's age, so "posted 3 days
            // ago" would quietly become false after every pause.
            ...(data.status &&
              shouldStampPublishedAt(data.status, job.publishedAt) && {
                publishedAt: new Date(),
              }),
          },
        })

        // Re-generate embedding if description changed
        if (data.description && data.description !== job.description) {
          const { addEmbeddingJob } = await import('@/lib/queue')
          addEmbeddingJob({ jobId: params.id }).catch((err) => {
            logger.error('Failed to queue job embedding:', err)
            // Don't throw - embedding is nice-to-have, not critical
          })
        }

        logger.info('Job updated', { jobId: updated.id })

        revalidatePath('/jobs')
        revalidatePath('/employer')

        return NextResponse.json(updated)
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'Validation failed', issues: error.issues },
            { status: 400 },
          )
        }

        logger.apiError('PUT', `/api/jobs/[id]`, error)
        const errorData = errorResponse(error)
        return NextResponse.json(errorData, { status: errorData.statusCode })
      }
    },
    { preset: 'api', byUser: true },
  ),
)

// PATCH is an alias for PUT (both allow updates)
export const PATCH = PUT

// Delete job (soft delete - set status to CLOSED)
export const DELETE = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      try {
        const params = context?.params
        if (!params?.id) {
          return NextResponse.json({ error: 'Missing job ID' }, { status: 400 })
        }

        logger.apiRequest('DELETE', `/api/jobs/${params.id}`)

        const session = await requireAuth()

        if (!session.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Check if user owns the job through organization
        // findFirst, not findUnique: the soft-delete middleware in lib/prisma.ts
        // only augments findFirst/findMany/count, so findUnique returned
        // soft-deleted jobs and left them mutable.
        const job = await prisma.job.findFirst({
          where: { id: params.id },
          include: {
            organization: {
              include: {
                users: {
                  where: { userId: session.user.id, deletedAt: null },
                },
              },
            },
          },
        })

        if (!job || job.organization.users.length === 0) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        // AUTH-006: only admins and recruiters may delete jobs
        const memberRole = job.organization.users[0].role
        if (!['ORG_ADMIN', 'RECRUITER'].includes(memberRole)) {
          return NextResponse.json(
            { error: 'You do not have permission to delete jobs' },
            { status: 403 },
          )
        }

        // Soft delete - set status to CLOSED
        const updated = await prisma.job.update({
          where: { id: params.id },
          data: {
            // Both fields, matching deleteJob in lib/actions/jobs.ts. This route
            // set only `status`, so the same "delete" left the row visible to
            // every findFirst/findMany in the app depending on which door the
            // user happened to come through.
            status: 'CLOSED',
            deletedAt: new Date(),
          },
        })

        logger.info('Job closed', { jobId: updated.id })

        revalidatePath('/jobs')
        revalidatePath('/employer')

        return NextResponse.json({ success: true })
      } catch (error) {
        logger.apiError('DELETE', `/api/jobs/[id]`, error)
        const errorData = errorResponse(error)
        return NextResponse.json(errorData, { status: errorData.statusCode })
      }
    },
    { preset: 'api', byUser: true },
  ),
)
