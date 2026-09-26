/**
 * Assessment AI Draft API (POST)
 *
 * An org member (recruiter role) asks the AI to draft an assessment from a job
 * title + description. The draft is validated against `createAssessmentSchema`
 * and returned to the builder — it is NOT persisted here.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { resolveActiveMembership } from '@/lib/api-helpers'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { generateAssessment } from '@jobsphere/ai'
import { createAssessmentSchema } from '@/schemas/assessment.schema'

export const runtime = 'nodejs'

const GENERATE_ROLES = ['ORG_ADMIN', 'RECRUITER', 'HIRING_MANAGER']

const bodySchema = z.object({
  jobTitle: z.string().min(1).max(200),
  jobDescription: z.string().min(1).max(10000),
  locale: z.string().length(2).optional(),
})

export const POST = withCsrfProtection<Request>(
  withRateLimit<Request>(
    async (request: Request) => {
      try {
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Recruiter-level org membership required (same gate as creating one).
        const userOrg = await resolveActiveMembership(session.user.id, session.user.activeOrgId)
        if (!userOrg || !GENERATE_ROLES.includes(userOrg.role)) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const apiKey = process.env.ANTHROPIC_API_KEY
        if (!apiKey) {
          logger.error('assessments/generate: ANTHROPIC_API_KEY not configured')
          return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
        }

        const body = await request.json().catch(() => ({}))
        const parsed = bodySchema.safeParse(body)
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Invalid request data', details: parsed.error.flatten().fieldErrors },
            { status: 400 },
          )
        }

        const draft = await generateAssessment(
          {
            jobTitle: parsed.data.jobTitle,
            jobDescription: parsed.data.jobDescription,
            locale: parsed.data.locale,
          },
          { apiKey },
        )

        // The model output is untrusted — validate it into the exact builder shape.
        // `locale: undefined` lets the schema default apply.
        const validation = createAssessmentSchema.safeParse({
          ...draft,
          locale: parsed.data.locale,
        })
        if (!validation.success) {
          logger.error('AI assessment draft failed schema validation', {
            issues: validation.error.issues,
          })
          return NextResponse.json(
            { error: 'AI returned an invalid assessment draft. Please try again.' },
            { status: 502 },
          )
        }

        return NextResponse.json({ assessment: validation.data })
      } catch (error) {
        logger.error('Failed to generate assessment draft', error)
        return NextResponse.json({ error: 'Failed to generate assessment' }, { status: 500 })
      }
    },
    { preset: 'api', byUser: true },
  ),
)
