import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { addEmailSequenceJob } from '@/lib/queue'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

// IDs in this app are cuids (Prisma @default(cuid())), not UUIDs — validating
// with .uuid() rejected every real id and made enroll return 400 (LOGIC-012).
const enrollSchema = z.object({
  candidateId: z.string().cuid(),
  jobId: z.string().cuid().optional(),
})

export const POST = withCsrfProtection(
  withRateLimit(
    async (req: NextRequest, context?: { params?: Record<string, string> }) => {
      try {
        const params = context?.params
        if (!params?.id) {
          return NextResponse.json({ error: 'Missing sequence ID' }, { status: 400 })
        }

        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await req.json()
        const validation = enrollSchema.safeParse(body)

        if (!validation.success) {
          return NextResponse.json(
            { error: 'Invalid request data', details: validation.error.issues },
            { status: 400 },
          )
        }

        const { candidateId } = validation.data

        // Get user's organizations
        const userOrgs = await prisma.userOrgRole.findMany({
          where: { userId: session.user.id, deletedAt: null },
          select: { orgId: true },
        })

        const orgIds = userOrgs.map((o: { orgId: string }) => o.orgId)

        // Verify sequence exists and user has access
        const sequence = await prisma.emailSequence.findFirst({
          where: {
            id: params.id,
            orgId: { in: orgIds },
            active: true,
          },
          include: {
            steps: {
              orderBy: { order: 'asc' },
            },
          },
        })

        if (!sequence) {
          return NextResponse.json({ error: 'Sequence not found or inactive' }, { status: 404 })
        }

        if (!sequence.steps || sequence.steps.length === 0) {
          return NextResponse.json({ error: 'Sequence has no steps' }, { status: 400 })
        }

        // Verify the candidate belongs to the same organization as the authenticated user
        const candidate = await prisma.candidate.findUnique({
          where: { id: candidateId },
          select: { orgId: true },
        })

        if (!candidate || !orgIds.includes(candidate.orgId)) {
          return NextResponse.json(
            { error: 'Candidate not found or access denied' },
            { status: 403 },
          )
        }

        // Idempotency: if the candidate already has a non-terminal run for this
        // sequence, return it instead of creating a duplicate ACTIVE run.
        // (A DB unique constraint on [sequenceId, candidateId] also backstops this.)
        const existing = await prisma.emailSequenceRun.findFirst({
          where: {
            sequenceId: params.id,
            candidateId,
            status: { in: ['ACTIVE', 'PAUSED'] },
          },
        })

        if (existing) {
          return NextResponse.json({
            success: true,
            runId: existing.id,
            alreadyEnrolled: true,
            message: 'Candidate is already enrolled in this sequence',
          })
        }

        // Create sequence run. The engine (worker + cron) drives sending from
        // currentStep=0, honoring each step's dayOffset/conditions, so we do NOT
        // pre-queue the first step here (avoids the previous orphan-run bug where
        // a missing order===1 step left an ACTIVE run that never sent anything).
        let run
        try {
          run = await prisma.emailSequenceRun.create({
            data: {
              sequenceId: params.id,
              candidateId,
              status: 'ACTIVE',
              currentStep: 0,
            },
          })
        } catch (createError) {
          // Unique [sequenceId, candidateId] race → treat as idempotent success.
          const dup = await prisma.emailSequenceRun.findFirst({
            where: { sequenceId: params.id, candidateId },
          })
          if (dup) {
            return NextResponse.json({
              success: true,
              runId: dup.id,
              alreadyEnrolled: true,
              message: 'Candidate is already enrolled in this sequence',
            })
          }
          throw createError
        }

        // Kick the engine immediately for this run so a due first step (dayOffset 0,
        // conditions met) goes out without waiting for the next 15-min cron scan.
        // The worker is idempotent and honors due-date/conditions, so this is safe.
        const firstStep = sequence.steps[0]
        if (firstStep) {
          await addEmailSequenceJob({
            enrollmentId: run.id,
            stepId: firstStep.id,
          })
        }

        return NextResponse.json({
          success: true,
          runId: run.id,
          message: 'Candidate enrolled successfully',
        })
      } catch (error) {
        logger.error('Failed to enroll candidate in email sequence:', error)

        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'Validation failed', details: error.issues },
            { status: 400 },
          )
        }

        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
      }
    },
    { preset: 'api', byUser: true },
  ),
)
