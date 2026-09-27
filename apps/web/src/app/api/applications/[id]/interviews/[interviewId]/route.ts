/**
 * Reschedule or cancel a single interview.
 *
 * The parent route only ever offered GET and POST, so an interview could be
 * booked and never moved or called off. `Interview.status` has always known
 * about CANCELED and nothing in the application ever set it — the value existed
 * purely as documentation.
 *
 * Cancelling therefore flips the status rather than deleting the row: the
 * candidate was invited, the slot was held, and someone will eventually ask what
 * happened to it. A deleted row cannot answer.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/errors'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const updateInterviewSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  durationMin: z.number().int().min(5).max(600).optional().nullable(),
  type: z.enum(['VIDEO', 'ONSITE', 'PHONE']).optional(),
  location: z.string().max(500).optional().nullable(),
  branchId: z.string().optional().nullable(),
  meetingUrl: z.string().url().max(500).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  status: z.enum(['SCHEDULED', 'DONE', 'CANCELED']).optional(),
})

function ids(context?: { params?: Record<string, string> }) {
  const applicationId = context?.params?.id
  const interviewId = context?.params?.interviewId
  return applicationId && interviewId ? { applicationId, interviewId } : null
}

/**
 * Loads the interview and asserts the caller belongs to the organisation that
 * owns it. Scoped on the interview's own orgId rather than by joining through
 * the application — Interview carries orgId precisely so this is one lookup.
 */
async function findOwnedInterview(interviewId: string, applicationId: string, userId: string) {
  const interview = await prisma.interview.findFirst({
    where: { id: interviewId, applicationId },
  })
  if (!interview) return null

  const membership = await prisma.userOrgRole.findFirst({
    where: { userId, orgId: interview.orgId, deletedAt: null },
  })
  return membership ? interview : null
}

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      try {
        const parsed = ids(context)
        if (!parsed) {
          return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
        }

        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const data = updateInterviewSchema.parse(await req.json())

        const interview = await findOwnedInterview(
          parsed.interviewId,
          parsed.applicationId,
          session.user.id,
        )
        if (!interview) {
          return NextResponse.json({ error: 'Interview not found' }, { status: 404 })
        }

        // A cancelled interview is a closed record. Reopening it by editing would
        // lose the fact that it was called off; book a new one instead.
        if (interview.status === 'CANCELED') {
          return NextResponse.json(
            { error: 'This interview was cancelled. Schedule a new one instead.' },
            { status: 409 },
          )
        }

        // A branch must belong to the interview's own org — POST enforces this and
        // PATCH used to write any branch id straight through (cross-tenant IDOR).
        if (data.branchId) {
          const branch = await prisma.branch.findUnique({ where: { id: data.branchId } })
          if (!branch || branch.deletedAt || branch.orgId !== interview.orgId) {
            return NextResponse.json({ error: 'Invalid branch' }, { status: 400 })
          }
        }

        const updated = await prisma.interview.update({
          where: { id: parsed.interviewId },
          data: {
            ...(data.scheduledAt !== undefined && { scheduledAt: new Date(data.scheduledAt) }),
            ...(data.durationMin !== undefined && { durationMin: data.durationMin }),
            ...(data.type !== undefined && { type: data.type }),
            ...(data.location !== undefined && { location: data.location }),
            ...(data.branchId !== undefined && { branchId: data.branchId }),
            ...(data.meetingUrl !== undefined && { meetingUrl: data.meetingUrl }),
            ...(data.notes !== undefined && { notes: data.notes }),
            ...(data.status !== undefined && { status: data.status }),
          },
        })

        // The timeline is what the recruiter reads later; a slot that moved
        // without a trace is worse than one that never moved.
        if (data.scheduledAt || data.status) {
          await prisma.applicationActivity.create({
            data: {
              applicationId: parsed.applicationId,
              type: 'INTERVIEW_UPDATED',
              description:
                data.status === 'CANCELED'
                  ? 'Interview cancelled'
                  : `Interview rescheduled to ${updated.scheduledAt.toISOString()}`,
              performedBy: session.user.id,
            },
          })
        }

        logger.info('Interview updated', { interviewId: parsed.interviewId })

        return NextResponse.json({ interview: updated })
      } catch (error) {
        return handleApiError(error)
      }
    },
    { preset: 'api', byUser: true },
  ),
)

/**
 * Cancels — it does not delete. See the file header.
 */
export const DELETE = withCsrfProtection(
  withRateLimit(
    async (_req: Request, context?: { params?: Record<string, string> }) => {
      try {
        const parsed = ids(context)
        if (!parsed) {
          return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
        }

        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const interview = await findOwnedInterview(
          parsed.interviewId,
          parsed.applicationId,
          session.user.id,
        )
        if (!interview) {
          return NextResponse.json({ error: 'Interview not found' }, { status: 404 })
        }

        const cancelled = await prisma.interview.update({
          where: { id: parsed.interviewId },
          data: { status: 'CANCELED' },
        })

        await prisma.applicationActivity.create({
          data: {
            applicationId: parsed.applicationId,
            type: 'INTERVIEW_UPDATED',
            description: 'Interview cancelled',
            performedBy: session.user.id,
          },
        })

        logger.info('Interview cancelled', { interviewId: parsed.interviewId })

        return NextResponse.json({ interview: cancelled })
      } catch (error) {
        return handleApiError(error)
      }
    },
    { preset: 'api', byUser: true },
  ),
)
