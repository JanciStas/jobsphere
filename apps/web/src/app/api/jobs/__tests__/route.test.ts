/**
 * PR5 — POST /api/jobs new fields + security.
 *
 * Covers:
 *  - happy path persisting sub-HR assignment, ad media and screening questions
 *  - 400 when the assigned recruiter is not a member of the caller's org (IDOR)
 *  - 400 when the referenced assessment belongs to another org (IDOR)
 *  - assessment happy path (requiresAssessment + assessmentId persisted)
 *  - `currency` client alias resolving into salaryCurrency
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: unknown) => h }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (h: unknown) => h }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), apiRequest: vi.fn(), apiError: vi.fn() },
}))
vi.mock('@/lib/errors', () => ({
  errorResponse: () => ({ error: 'Internal error', statusCode: 500 }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { requireAuth } = vi.hoisted(() => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth }))

const { checkEntitlement, consumeEntitlement } = vi.hoisted(() => ({
  checkEntitlement: vi.fn(),
  consumeEntitlement: vi.fn(),
}))
vi.mock('@/lib/entitlements', () => ({ checkEntitlement, consumeEntitlement }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    userOrgRole: { findFirst: vi.fn() },
    assessment: { findFirst: vi.fn() },
    job: { create: vi.fn() },
  },
}))

import { POST } from '../route'
import { prisma } from '@/lib/prisma'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const ORG_ID = 'org1'
const RECRUITER_ID = 'rec1'

function req(body: Record<string, unknown>) {
  return new Request('http://localhost/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const base = {
  title: 'Senior React Developer',
  description: 'x'.repeat(60),
  requirements: 'y'.repeat(30),
  workMode: 'ONSITE',
  type: 'FULL_TIME',
  seniority: 'MID',
  location: 'Bratislava',
}

function lastCreateData() {
  return asMock(prisma.job.create).mock.calls[0][0].data
}

beforeEach(() => {
  vi.clearAllMocks()
  asMock(requireAuth).mockResolvedValue({ user: { id: 'u1' } })
  asMock(prisma.user.findUnique).mockResolvedValue({
    organizations: [{ role: 'ORG_ADMIN', organization: { id: ORG_ID } }],
  })
  asMock(checkEntitlement).mockResolvedValue(true)
  asMock(consumeEntitlement).mockResolvedValue(undefined)
  asMock(prisma.job.create).mockResolvedValue({ id: 'job1', organization: { name: 'Acme' } })
})

describe('POST /api/jobs — PR5', () => {
  it('persists sub-HR assignment, media and screening questions (happy path)', async () => {
    asMock(prisma.userOrgRole.findFirst).mockResolvedValue({ id: 'role1' })

    const res = await POST(
      req({
        ...base,
        assignedRecruiterId: RECRUITER_ID,
        imageUrl: 'https://blob.example.com/logos/x.png',
        videoUrl: 'https://blob.example.com/videos/x.mp4',
        screeningQuestions: ['  Years of React?  ', '', 'Notice period?'],
      }),
    )

    expect(res.status).toBe(201)
    const data = lastCreateData()
    expect(data.assignedRecruiterId).toBe(RECRUITER_ID)
    expect(data.imageUrl).toBe('https://blob.example.com/logos/x.png')
    expect(data.videoUrl).toBe('https://blob.example.com/videos/x.mp4')
    // trimmed + empty entries dropped
    expect(data.screeningQuestions).toEqual(['Years of React?', 'Notice period?'])
    expect(data.requiresAssessment).toBe(false)
    expect(data.assessmentId).toBeNull()
    // recruiter membership was verified against the caller's org
    expect(prisma.userOrgRole.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: RECRUITER_ID, orgId: ORG_ID }),
      }),
    )
  })

  it('resolves the caller’s org from live memberships only, preferring the active org', async () => {
    asMock(requireAuth).mockResolvedValue({ user: { id: 'u1', activeOrgId: 'org-b' } })
    asMock(prisma.user.findUnique).mockResolvedValue({
      organizations: [
        { orgId: 'org-a', role: 'ORG_ADMIN', organization: { id: 'org-a' } },
        { orgId: 'org-b', role: 'ORG_ADMIN', organization: { id: 'org-b' } },
      ],
    })

    const res = await POST(req(base))

    expect(res.status).toBe(201)
    // Nested includes bypass the soft-delete middleware: a removed member must be
    // filtered out in the query itself.
    const include = asMock(prisma.user.findUnique).mock.calls[0][0].include
    expect(include.organizations.where).toEqual({ deletedAt: null })
    expect(lastCreateData().orgId ?? lastCreateData().organization?.connect?.id).toBe('org-b')
  })

  it('rejects an assigned recruiter who is not a member of the org (400, no create)', async () => {
    asMock(prisma.userOrgRole.findFirst).mockResolvedValue(null)

    const res = await POST(req({ ...base, assignedRecruiterId: 'outsider' }))

    expect(res.status).toBe(400)
    expect(prisma.job.create).not.toHaveBeenCalled()
  })

  it('rejects an assessment owned by another org (400, no create)', async () => {
    asMock(prisma.assessment.findFirst).mockResolvedValue(null)

    const res = await POST(req({ ...base, assessmentId: 'foreign-assessment' }))

    expect(res.status).toBe(400)
    expect(prisma.job.create).not.toHaveBeenCalled()
  })

  it('links an org-owned assessment (requiresAssessment + assessmentId persisted)', async () => {
    asMock(prisma.assessment.findFirst).mockResolvedValue({ id: 'assess1' })

    const res = await POST(req({ ...base, assessmentId: 'assess1' }))

    expect(res.status).toBe(201)
    const data = lastCreateData()
    expect(data.requiresAssessment).toBe(true)
    expect(data.assessmentId).toBe('assess1')
    expect(prisma.assessment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'assess1', orgId: ORG_ID }),
      }),
    )
  })

  it('accepts the `currency` client alias into salaryCurrency', async () => {
    const res = await POST(req({ ...base, currency: 'USD' }))

    expect(res.status).toBe(201)
    expect(lastCreateData().salaryCurrency).toBe('USD')
  })
})
