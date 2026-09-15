import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { getOrCreateCandidateForUser, getPersonalCandidateForUser } from '@/lib/identity'
import { APPLICATION_STAGES } from '@/lib/constants/application-stages'
import { z } from 'zod'

const stageEnum = z.enum(APPLICATION_STAGES).optional()
const paginationSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
})

// Validate the apply payload server-side (SEC-009/010): bound coverLetter length
// and require a cuid jobId, matching the createApplication server action. Without
// this the POST accepted an unbounded coverLetter and an unvalidated jobId.
const createApplicationBodySchema = z.object({
  jobId: z.string().cuid(),
  coverLetter: z.string().min(1).max(5000),
  expectedSalary: z.string().max(100).optional(),
  availableFrom: z.string().max(100).optional(),
  // Optional id of one of the applicant's saved profile CVs (a Resume on their
  // personal candidate). When present we copy it onto the employer-org candidate
  // so the company actually sees the CV with the application.
  cvId: z.string().cuid().optional(),
})

/**
 * Copy the applicant's chosen profile CV (a Resume on their personal candidate)
 * onto the employer-org Candidate so the company sees it on the applicant detail.
 * Builder-shaped experience/education fields are normalized to the shape the
 * employer view expects. Best-effort: never throws (the application still stands).
 */
export async function copyProfileCvToCandidate(
  userId: string,
  employerCandidateId: string,
  cvId: string,
): Promise<boolean> {
  try {
    const personal = await getPersonalCandidateForUser(userId)
    const src = await prisma.resume.findFirst({
      where: { id: cvId, candidateId: personal.id, deletedAt: null },
      include: { sourceDocument: true },
    })
    if (!src) {
      // The client offered a cvId the server can't honor (not the user's CV, or
      // deleted between selection and submit). Warn so it's diagnosable; the
      // caller surfaces cvAttached:false to the applicant.
      logger.warn('Profile CV not attachable to application', { userId, cvId })
      return false
    }

    const exps = (Array.isArray(src.experiences) ? src.experiences : []).map((e: any) => ({
      title: e.position || e.title || '',
      company: e.company || '',
      startDate: e.period || e.startDate || '',
      endDate: e.endDate || '',
      current: !!e.current,
      description: e.description || '',
    }))
    const edus = (Array.isArray(src.education) ? src.education : []).map((e: any) => ({
      institution: e.school || e.institution || '',
      field: e.field || '',
      degree: e.degree || '',
      startDate: e.startDate || '',
      endDate: e.year || e.endDate || '',
    }))

    // Atomic: copy the source file (if any) AND the Resume together so a failure
    // can never leave an orphaned CandidateDocument with no Resume referencing it.
    await prisma.$transaction(async (tx) => {
      let sourceDocumentId: string | undefined
      if (src.sourceDocument) {
        const d = src.sourceDocument
        const copy = await tx.candidateDocument.create({
          data: {
            candidateId: employerCandidateId,
            type: d.type,
            filename: d.filename,
            uri: d.uri,
            mime: d.mime,
            size: d.size,
            hash: d.hash,
            parsedAt: d.parsedAt,
            parsedText: d.parsedText,
          },
          select: { id: true },
        })
        sourceDocumentId = copy.id
      }
      await tx.resume.create({
        data: {
          candidateId: employerCandidateId,
          sourceDocumentId,
          language: src.language,
          summary: src.summary,
          yearsOfExperience: src.yearsOfExperience,
          personalInfo: src.personalInfo ?? undefined,
          experiences: exps,
          education: edus,
          languages: src.languages ?? undefined,
          skills: src.skills,
        },
      })
    })
    return true
  } catch (error) {
    logger.error('Failed to copy profile CV onto application candidate', { error })
    return false
  }
}

export const runtime = 'nodejs'

export const GET = withRateLimit(
  async (req: Request) => {
    try {
      const session = await auth()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { searchParams } = new URL(req.url)
      const stageRaw = searchParams.get('stage') || undefined
      const jobId = searchParams.get('jobId')
      const validatedStage = stageEnum.parse(stageRaw)
      // `searchParams.get` returns null for an absent param, and a Zod `.default()`
      // only fires on undefined — so `z.coerce.number().min(1).default(1)` coerced
      // null to 0, failed min(1), and the handler answered its own default request
      // with 500. Every plain GET of "my applications" hit this. Coalesce to
      // undefined so the defaults apply, as the jobs route already does.
      const { page, limit } = paginationSchema.parse({
        page: searchParams.get('page') ?? undefined,
        limit: searchParams.get('limit') ?? undefined,
      })

      // Resolve Candidate records linked to this user by email across all orgs
      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { email: true },
      })
      if (!user?.email) {
        return NextResponse.json({ data: [], total: 0, page, pageSize: limit, hasMore: false })
      }

      const contacts = await prisma.candidateContact.findMany({
        where: { email: user.email },
        select: { candidateId: true },
      })
      const candidateIds = contacts.map((c) => c.candidateId)

      const where = {
        candidateId: { in: candidateIds },
        ...(validatedStage && { stage: validatedStage }),
        ...(jobId && { jobId }),
      }

      // Explicit select instead of a bare `include`. A bare include returns every
      // Job column — description (up to 10k chars), requirements, responsibilities,
      // benefits and the pipeline/translations/screeningQuestions JSON blobs — plus
      // every Application column, times `limit` rows per page. This list view needs
      // none of them, so the heavy text/JSON fields are omitted (see NOTE below);
      // every cheap scalar is kept so the response shape is otherwise unchanged.
      // Page rows + total count are independent — run them concurrently.
      const [applications, total] = await Promise.all([
        prisma.application.findMany({
          where,
          select: {
            id: true,
            candidateId: true,
            jobId: true,
            orgId: true,
            stage: true,
            score: true,
            assignedTo: true,
            tags: true,
            source: true,
            referredBy: true,
            expectedSalary: true,
            availableFrom: true,
            lastContactAt: true,
            lastContactType: true,
            isStarred: true,
            isPriority: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
            // NOTE: coverLetter / stageHistory / scoreDetails / notes are omitted —
            // large per-row payloads and recruiter-internal data that this
            // candidate-facing list never renders.
            job: {
              select: {
                id: true,
                orgId: true,
                title: true,
                city: true,
                region: true,
                country: true,
                remote: true,
                hybrid: true,
                employmentType: true,
                seniority: true,
                salaryMin: true,
                salaryMax: true,
                salaryCurrency: true,
                salaryPeriod: true,
                locale: true,
                status: true,
                publishedAt: true,
                closedAt: true,
                viewCount: true,
                imageUrl: true,
                videoUrl: true,
                requiresAssessment: true,
                assessmentId: true,
                slug: true,
                createdAt: true,
                updatedAt: true,
                // NOTE: description / requirements / responsibilities / benefits /
                // translations / pipeline / screeningQuestions omitted — the heavy
                // fields this endpoint was fetching for nothing.
                organization: {
                  select: {
                    name: true,
                    logo: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.application.count({ where }),
      ])

      return NextResponse.json({
        data: applications,
        total,
        page,
        pageSize: limit,
        hasMore: page * limit < total,
      })
    } catch (error) {
      // A bad `stage` or `page` is the caller's mistake, not ours; it used to be
      // reported as 500 alongside genuine server faults.
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Invalid query parameters', issues: error.issues },
          { status: 400 },
        )
      }
      logger.error('Error fetching applications', error)
      return NextResponse.json({ error: 'Failed to fetch applications' }, { status: 500 })
    }
  },
  { preset: 'api', byUser: true },
)

export const POST = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      try {
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json()
        const parsed = createApplicationBodySchema.safeParse(body)
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Invalid application data', details: parsed.error.flatten().fieldErrors },
            { status: 400 },
          )
        }
        const { jobId, coverLetter, cvId, expectedSalary, availableFrom } = parsed.data

        // Coerce the optional applicant-provided fields to their column types.
        const expectedSalaryInt = expectedSalary ? Number.parseInt(expectedSalary, 10) : NaN
        const availableFromDate = availableFrom ? new Date(availableFrom) : null

        // Get job to fetch orgId, verify it's published, and learn whether it
        // requires an assessment (L52/L54) so we can auto-invite on apply.
        const job = await prisma.job.findUnique({
          where: { id: jobId },
          select: {
            orgId: true,
            status: true,
            requiresAssessment: true,
            assessmentId: true,
          },
        })

        if (!job) {
          return NextResponse.json({ error: 'Job not found' }, { status: 404 })
        }

        // Only allow applications to published jobs
        if (job.status !== 'PUBLISHED') {
          return NextResponse.json(
            { error: 'This job is not currently accepting applications' },
            { status: 400 },
          )
        }

        // Find or create the org-scoped Candidate for this user, linking it to
        // the User account (Candidate.userId) so candidate self-service flows work.
        let candidateId: string
        try {
          const candidate = await getOrCreateCandidateForUser(session.user.id, job.orgId)
          candidateId = candidate.id
        } catch (resolveError) {
          logger.error('Failed to resolve candidate for application', resolveError)
          return NextResponse.json(
            { error: 'User account is missing an email address' },
            { status: 400 },
          )
        }

        // Check if already applied
        const existingApplication = await prisma.application.findFirst({
          where: { jobId, candidateId },
        })

        if (existingApplication) {
          return NextResponse.json(
            { error: 'You have already applied to this job' },
            { status: 409 },
          )
        }

        // Create application (persist the applicant's salary/availability inputs,
        // which the apply form collects — previously they were silently dropped).
        const application = await prisma.application.create({
          data: {
            jobId,
            candidateId,
            orgId: job.orgId,
            coverLetter,
            stage: 'NEW',
            ...(Number.isFinite(expectedSalaryInt) && expectedSalaryInt >= 0
              ? { expectedSalary: expectedSalaryInt }
              : {}),
            ...(availableFromDate && !Number.isNaN(availableFromDate.getTime())
              ? { availableFrom: availableFromDate }
              : {}),
          },
          include: {
            job: {
              include: {
                organization: true,
              },
            },
          },
        })

        // Create application activity
        await prisma.applicationActivity.create({
          data: {
            applicationId: application.id,
            type: 'APPLIED',
            description: 'Your application has been successfully submitted',
            performedBy: session.user.id,
          },
        })

        // Attach the applicant's chosen saved CV so the employer sees it. Track
        // the outcome so we can honestly tell the applicant if it didn't attach.
        let cvAttached: boolean | undefined
        if (cvId) {
          cvAttached = await copyProfileCvToCandidate(session.user.id, candidateId, cvId)
        }

        // If the job requires an assessment (L52/L54), mint an invite for this
        // candidate and hand the token back so the client can route them into
        // the test runner. Best-effort: never block the application on it.
        let assessmentInvite: { assessmentId: string; token: string } | undefined
        if (job.requiresAssessment && job.assessmentId) {
          try {
            const { createOrGetAssessmentInvite } = await import('@/lib/assessment-invite')
            const { token } = await createOrGetAssessmentInvite({
              assessmentId: job.assessmentId,
              candidateId,
              jobId,
            })
            assessmentInvite = { assessmentId: job.assessmentId, token }
          } catch (inviteError) {
            logger.error('Failed to create assessment invite on apply', inviteError)
          }
        }

        // Send email notifications
        try {
          const { sendEmail, getApplicationReceivedEmail, getNewApplicationEmail } = await import(
            '@/lib/email'
          )

          // Email to candidate
          if (session.user.email) {
            await sendEmail({
              to: session.user.email,
              subject: `Application Received - ${application.job.title}`,
              html: getApplicationReceivedEmail(
                session.user.name || 'Candidate',
                application.job.title,
                application.job.organization.name,
              ),
            })
          }

          // Email to employer (get org admin email)
          const orgAdmin = await prisma.userOrgRole.findFirst({
            where: {
              orgId: application.job.orgId,
              role: 'ORG_ADMIN',
            },
            include: {
              user: true,
            },
          })

          if (orgAdmin?.user.email) {
            await sendEmail({
              to: orgAdmin.user.email,
              subject: `New Application - ${application.job.title}`,
              html: getNewApplicationEmail(
                orgAdmin.user.name || 'Employer',
                session.user.name || 'Unknown Candidate',
                application.job.title,
                application.id,
              ),
            })
          }
        } catch (emailError) {
          logger.error('Failed to send email notifications', emailError)
          // Don't fail the request if email fails
        }

        return NextResponse.json({ ...application, cvAttached, assessmentInvite }, { status: 201 })
      } catch (error: any) {
        logger.error('Error creating application', error)

        // Handle unique constraint violation (race condition)
        if (error.code === 'P2002') {
          return NextResponse.json(
            { error: 'You have already applied to this job' },
            { status: 409 },
          )
        }

        return NextResponse.json({ error: 'Failed to create application' }, { status: 500 })
      }
    },
    { preset: 'api', byUser: true }, // 100 requests per minute
  ),
)
