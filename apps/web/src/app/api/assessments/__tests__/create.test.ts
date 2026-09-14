/**
 * POST /api/assessments — regression for a field-name mismatch.
 *
 * The request schema calls the coding-question field `code`; the Prisma model
 * calls it `starterCode`. The route forwarded `code` verbatim, so every
 * assessment containing a CODE question failed with a Prisma validation error
 * and a 500 — a whole question type that could never be saved.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), apiRequest: vi.fn() },
}))
vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (handler: any) => handler }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (handler: any) => handler }))

const { requireAuth } = vi.hoisted(() => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  requireAuth,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userOrgRole: { findFirst: vi.fn() },
    assessment: { create: vi.fn() },
  },
}))

import { POST } from '../route'
import { prisma } from '@/lib/prisma'

const body = {
  name: 'Backend screening',
  sections: [
    {
      title: 'Coding',
      questions: [
        {
          type: 'CODE',
          text: 'Reverse a linked list',
          code: 'function reverse(head) {\n  // TODO\n}',
          language: 'javascript',
          points: 5,
        },
      ],
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAuth.mockResolvedValue({ user: { id: 'user-1' } })
  ;(prisma.userOrgRole.findFirst as any).mockResolvedValue({
    orgId: 'org-1',
    role: 'RECRUITER',
    organization: { name: 'Acme' },
  })
  ;(prisma.assessment.create as any).mockResolvedValue({
    id: 'a-1',
    sections: [{ questions: [{ id: 'q-1' }] }],
  })
})

describe('POST /api/assessments with a CODE question', () => {
  it('maps the request field `code` onto the model field `starterCode`', async () => {
    const res = await POST(
      new Request('http://localhost/api/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }) as any,
    )

    expect(res.status).toBe(201)
    const data = (prisma.assessment.create as any).mock.calls[0][0].data
    const question = data.sections.create[0].questions.create[0]
    expect(question.starterCode).toBe(body.sections[0].questions[0].code)
    // The unknown key is what Prisma rejected. Its absence is the fix.
    expect(question).not.toHaveProperty('code')
  })
})
