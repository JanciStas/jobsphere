/**
 * GET /api/assessments/[id]/results/[attemptId]
 *
 * The route that the results page had been calling into thin air. Two classes of
 * behaviour are worth pinning: the tenant boundary (an attempt belongs to one
 * candidate and one organisation, and nobody else may read it) and the
 * translation between the page's vocabulary and the database's.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), apiRequest: vi.fn() },
}))
vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (handler: any) => handler }))

const { requireAuth } = vi.hoisted(() => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  requireAuth,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    attempt: { findFirst: vi.fn() },
    userOrgRole: { findFirst: vi.fn() },
  },
}))

import { GET } from '../route'
import { prisma } from '@/lib/prisma'

const GRADED_AT = new Date('2026-09-10T12:00:00.000Z')

const attemptFixture = (overrides: Record<string, unknown> = {}) => ({
  id: 'attempt-1',
  status: 'GRADED',
  totalScore: 7,
  percentage: 70,
  submittedAt: new Date('2026-09-10T11:00:00.000Z'),
  feedback: 'Solid fundamentals.',
  candidate: { userId: 'candidate-user' },
  invite: {
    assessment: {
      orgId: 'org-1',
      name: 'Backend screening',
      passingScore: 60,
      sections: [
        {
          questions: [
            { id: 'q-1', type: 'MCQ', text: 'Pick one', points: 4 },
            { id: 'q-2', type: 'CODE', text: 'Reverse a list', points: 6 },
          ],
        },
      ],
    },
  },
  answers: [
    {
      id: 'a-1',
      questionId: 'q-1',
      response: { choice: 2 },
      finalScore: 4,
      aiScore: null,
      autoScore: 4,
      manualScore: null,
      aiRationale: null,
      updatedAt: new Date('2026-09-10T11:59:00.000Z'),
    },
    {
      id: 'a-2',
      questionId: 'q-2',
      response: { code: 'return xs.reverse()' },
      finalScore: 3,
      aiScore: 3,
      autoScore: null,
      manualScore: null,
      aiRationale: 'Works, but mutates the input.',
      updatedAt: GRADED_AT,
    },
  ],
  ...overrides,
})

const call = (ctx = { params: { id: 'assessment-1', attemptId: 'attempt-1' } }) =>
  GET(new Request('http://localhost/api/assessments/assessment-1/results/attempt-1') as any, ctx)

beforeEach(() => {
  vi.clearAllMocks()
  requireAuth.mockResolvedValue({ user: { id: 'recruiter-1' } })
  ;(prisma.attempt.findFirst as any).mockResolvedValue(attemptFixture())
  ;(prisma.userOrgRole.findFirst as any).mockResolvedValue({ role: 'RECRUITER' })
})

describe('tenant boundary', () => {
  it('lets a member of the owning organisation read the attempt', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect((prisma.userOrgRole.findFirst as any).mock.calls[0][0].where).toMatchObject({
      userId: 'recruiter-1',
      orgId: 'org-1',
    })
  })

  it('lets the candidate read their own attempt without an org membership', async () => {
    requireAuth.mockResolvedValue({ user: { id: 'candidate-user' } })

    const res = await call()

    expect(res.status).toBe(200)
    // Own attempt short-circuits the membership lookup entirely.
    expect(prisma.userOrgRole.findFirst).not.toHaveBeenCalled()
  })

  it('404s for a signed-in user from another organisation', async () => {
    ;(prisma.userOrgRole.findFirst as any).mockResolvedValue(null)

    const res = await call()

    // 404 rather than 403: an outsider must not learn that this attempt exists.
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Attempt not found' })
  })

  it('pins the attempt to the assessment in the URL', async () => {
    await call()
    expect((prisma.attempt.findFirst as any).mock.calls[0][0].where).toEqual({
      id: 'attempt-1',
      invite: { assessmentId: 'assessment-1' },
    })
  })

  it('404s when the attempt does not exist', async () => {
    ;(prisma.attempt.findFirst as any).mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(404)
  })
})

describe('shape the results page expects', () => {
  it('translates database names into the page vocabulary', async () => {
    const { attempt } = await (await call()).json()

    expect(attempt.score).toBe(7)
    expect(attempt.assessment.title).toBe('Backend screening')
    expect(attempt.assessment.questions[0].title).toBe('Pick one')
    expect(attempt.answers[0].answer).toEqual({ choice: 2 })
  })

  it('computes maxScore from question points', async () => {
    const { attempt } = await (await call()).json()
    expect(attempt.maxScore).toBe(10)
  })

  it('derives scorePercent and isPassed from the totals, not the stored percentage', async () => {
    // Stored percentage is 70; 7 of 10 is also 70 — but a regrade can leave the
    // stored value behind, so the page must see the derived figure.
    ;(prisma.attempt.findFirst as any).mockResolvedValue(
      attemptFixture({ totalScore: 9, percentage: 70 }),
    )

    const { attempt } = await (await call()).json()

    expect(attempt.scorePercent).toBe(90)
    expect(attempt.isPassed).toBe(true)
  })

  it('marks a failing attempt as not passed', async () => {
    ;(prisma.attempt.findFirst as any).mockResolvedValue(attemptFixture({ totalScore: 2 }))
    const { attempt } = await (await call()).json()
    expect(attempt.scorePercent).toBe(20)
    expect(attempt.isPassed).toBe(false)
  })

  it('flattens questions across sections in order', async () => {
    const { attempt } = await (await call()).json()
    expect(attempt.assessment.questions.map((q: any) => q.id)).toEqual(['q-1', 'q-2'])
  })

  it('prefers a manual score over AI and automated', async () => {
    const fixture = attemptFixture()
    fixture.answers[0] = {
      ...fixture.answers[0],
      finalScore: null,
      manualScore: 2,
      aiScore: 1,
      autoScore: 0,
    }
    ;(prisma.attempt.findFirst as any).mockResolvedValue(fixture)

    const { attempt } = await (await call()).json()

    expect(attempt.answers[0].score).toBe(2)
  })
})

describe('grading progress', () => {
  it('reports gradedAt as the last answer touched once grading is done', async () => {
    // The page polls every 3 s until gradedAt is non-null; without it the
    // spinner never stops.
    const { attempt } = await (await call()).json()
    expect(attempt.gradedAt).toBe(GRADED_AT.toISOString())
  })

  it('leaves gradedAt null while the attempt is still being graded', async () => {
    ;(prisma.attempt.findFirst as any).mockResolvedValue(
      attemptFixture({ status: 'SUBMITTED', totalScore: null, percentage: null }),
    )

    const { attempt } = await (await call()).json()

    expect(attempt.gradedAt).toBeNull()
    expect(attempt.score).toBeNull()
    expect(attempt.isPassed).toBeNull()
  })
})
