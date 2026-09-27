/**
 * Assessment results for one attempt.
 *
 * The results page has been fetching this URL since it was written; the route
 * never existed, so every candidate and every recruiter who finished a test got
 * a spinner that never resolved. Confirmed in the 2026-09-14 sweep (finding H3).
 *
 * Two things this route has to reconcile:
 *
 *  * **Naming.** The page was written against a shape the database does not use:
 *    `score`/`maxScore`/`scorePercent`/`isPassed`/`gradedAt`, `assessment.title`,
 *    `question.title`, `answer.answer`. The schema calls these `totalScore`,
 *    `percentage`, `name`, `text`, `response` — and has no `maxScore`,
 *    `isPassed` or `gradedAt` at all. Translating here keeps the fix to one file
 *    instead of rewriting a page that already renders correctly.
 *  * **Who may look.** An attempt is visible to the candidate who sat it and to
 *    members of the organisation that owns the assessment — nobody else. A
 *    caller outside both gets 404 rather than 403, so the endpoint does not
 *    confirm that an attempt id exists.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/errors'
import { requireAuth } from '@/lib/auth'
import { withRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/** Grading writes scores onto answers, so the last answer touched is when grading finished. */
function derivedGradedAt(status: string, answers: Array<{ updatedAt: Date }>): string | null {
  if (status !== 'GRADED' || answers.length === 0) return null
  const latest = answers.reduce(
    (max, a) => (a.updatedAt > max ? a.updatedAt : max),
    answers[0].updatedAt,
  )
  return latest.toISOString()
}

export const GET = withRateLimit<NextRequest>(
  async (request: NextRequest, context?: { params?: Record<string, string> }) => {
    const assessmentId = context?.params?.id
    const attemptId = context?.params?.attemptId

    try {
      const session = await requireAuth()
      const userId = session.user?.id
      if (!userId) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      if (!assessmentId || !attemptId) {
        return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
      }

      const attempt = await prisma.attempt.findFirst({
        where: {
          id: attemptId,
          // Pinning the attempt to the assessment in the URL matters: without it
          // any attempt id could be read through any assessment id the caller
          // happens to have access to.
          invite: { assessmentId },
        },
        select: {
          id: true,
          status: true,
          totalScore: true,
          percentage: true,
          submittedAt: true,
          feedback: true,
          candidate: { select: { userId: true } },
          invite: {
            select: {
              assessment: {
                select: {
                  orgId: true,
                  name: true,
                  passingScore: true,
                  sections: {
                    orderBy: { order: 'asc' },
                    select: {
                      questions: {
                        orderBy: { order: 'asc' },
                        select: { id: true, type: true, text: true, points: true },
                      },
                    },
                  },
                },
              },
            },
          },
          answers: {
            select: {
              id: true,
              questionId: true,
              response: true,
              finalScore: true,
              aiScore: true,
              autoScore: true,
              manualScore: true,
              aiRationale: true,
              updatedAt: true,
            },
          },
        },
      })

      if (!attempt) {
        return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
      }

      const assessment = attempt.invite.assessment
      const isOwnAttempt = attempt.candidate.userId === userId
      const orgMembership = isOwnAttempt
        ? null
        : await prisma.userOrgRole.findFirst({
            where: { userId, orgId: assessment.orgId },
            select: { role: true },
          })

      if (!isOwnAttempt && !orgMembership) {
        // 404, not 403 — a caller outside the org learns nothing about whether
        // this attempt exists.
        logger.warn('Assessment results denied', { attemptId, assessmentId, userId })
        return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
      }

      const questions = assessment.sections.flatMap((section) => section.questions)
      const maxScore = questions.reduce((sum, question) => sum + question.points, 0)

      // `percentage` is stored, but a stored value can lag a regrade; derive it
      // when the raw score is present so the page and the totals agree.
      const scorePercent =
        attempt.totalScore != null && maxScore > 0
          ? Math.round((attempt.totalScore / maxScore) * 1000) / 10
          : (attempt.percentage ?? null)

      return NextResponse.json({
        attempt: {
          id: attempt.id,
          score: attempt.totalScore,
          maxScore,
          scorePercent,
          isPassed:
            scorePercent != null && assessment.passingScore != null
              ? scorePercent >= assessment.passingScore
              : null,
          submittedAt: attempt.submittedAt?.toISOString() ?? null,
          gradedAt: derivedGradedAt(attempt.status, attempt.answers),
          feedback: attempt.feedback,
          assessment: {
            title: assessment.name,
            passingScore: assessment.passingScore ?? 0,
            questions: questions.map((question) => ({
              id: question.id,
              type: question.type,
              title: question.text,
              points: question.points,
            })),
          },
          answers: attempt.answers.map((answer) => ({
            id: answer.id,
            questionId: answer.questionId,
            answer: answer.response,
            // Manual review wins over AI, AI over automated — the same order the
            // grading worker uses when it computes finalScore.
            score:
              answer.finalScore ?? answer.manualScore ?? answer.aiScore ?? answer.autoScore ?? null,
            feedback: answer.aiRationale,
          })),
        },
      })
    } catch (error) {
      logger.error('Failed to load assessment results', { error, assessmentId, attemptId })
      return handleApiError(error)
    }
  },
  { preset: 'api' },
)
