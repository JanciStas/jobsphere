/**
 * Tenant-isolation regressions (audit 2026-09-26: A1, A3, A4, A7).
 *
 * Each test drives the real route handler / guard with a mocked Prisma layer and
 * pins the DESIRED behaviour. They replaced the audit's "tripwire" tests, which
 * asserted that the vulnerabilities existed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: unknown) => h }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (h: unknown) => h }))
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    apiRequest: vi.fn(),
    apiError: vi.fn(),
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }))
vi.mock('@/lib/auth', () => ({
  auth: authMock,
  requireAuth: authMock,
  UnauthorizedError: class UnauthorizedError extends Error {},
}))

vi.mock('@/lib/errors', () => ({
  errorResponse: () => ({ error: 'Internal error', statusCode: 500 }),
  handleApiError: () => new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userOrgRole: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    user: { update: vi.fn() },
    job: { findFirst: vi.fn(), update: vi.fn() },
    assessment: { findFirst: vi.fn() },
    interview: { findFirst: vi.fn(), update: vi.fn() },
    branch: { findUnique: vi.fn() },
    applicationActivity: { create: vi.fn() },
    $transaction: vi.fn().mockResolvedValue([]),
  },
}))

import { prisma } from '@/lib/prisma'
import { requireOrgAuth } from '@/lib/api-helpers'
import { PUT as putJob } from '@/app/api/jobs/[id]/route'
import { PATCH as patchInterview } from '@/app/api/applications/[id]/interviews/[interviewId]/route'
import { DELETE as removeMember } from '@/app/api/organizations/current/members/[userId]/route'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

function jsonReq(method: string, url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const existingJob = () => ({
  id: 'job1',
  orgId: 'org1',
  status: 'DRAFT',
  description: 'x'.repeat(60),
  publishedAt: null,
  organization: { users: [{ role: 'ORG_ADMIN' }] },
})

beforeEach(() => {
  vi.clearAllMocks()
  asMock(prisma.$transaction).mockResolvedValue([])
  authMock.mockResolvedValue({ user: { id: 'u1', email: 'u1@example.com' } })
})

describe('A1/A7 — requireOrgAuth', () => {
  it('never resolves a soft-deleted membership', async () => {
    asMock(prisma.userOrgRole.findFirst).mockResolvedValue(null)

    await expect(requireOrgAuth()).rejects.toThrow(/No organization membership/)

    for (const call of asMock(prisma.userOrgRole.findFirst).mock.calls) {
      expect(call[0].where.deletedAt).toBeNull()
    }
  })

  it('resolves the org the user is currently acting in', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', email: 'u1@x.io', activeOrgId: 'org2' } })
    asMock(prisma.userOrgRole.findFirst).mockResolvedValue({
      orgId: 'org2',
      role: 'RECRUITER',
      organization: { id: 'org2' },
    })

    const ctx = await requireOrgAuth()

    expect(ctx.orgId).toBe('org2')
    expect(asMock(prisma.userOrgRole.findFirst).mock.calls[0][0].where).toMatchObject({
      userId: 'u1',
      orgId: 'org2',
      deletedAt: null,
    })
  })

  it('falls back to the first live membership when the active org is stale', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', email: 'u1@x.io', activeOrgId: 'gone' } })
    asMock(prisma.userOrgRole.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ orgId: 'org1', role: 'RECRUITER', organization: { id: 'org1' } })

    const ctx = await requireOrgAuth()

    expect(ctx.orgId).toBe('org1')
    expect(asMock(prisma.userOrgRole.findFirst).mock.calls[1][0].where).toEqual({
      userId: 'u1',
      deletedAt: null,
    })
  })
})

describe('A1 — removing a member revokes their sessions', () => {
  it('soft-deletes the membership and bumps sessionEpoch in one transaction', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin1', activeOrgId: 'org1' } })
    asMock(prisma.userOrgRole.findFirst)
      .mockResolvedValueOnce({ userId: 'admin1', orgId: 'org1', role: 'ORG_ADMIN' })
      .mockResolvedValueOnce({ userId: 'u2', orgId: 'org1', role: 'RECRUITER' })

    const res = await removeMember(new Request('http://localhost/api/x', { method: 'DELETE' }), {
      params: { userId: 'u2' },
    })

    expect(res.status).toBe(200)
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(asMock(prisma.$transaction).mock.calls[0][0]).toHaveLength(2)
    expect(asMock(prisma.userOrgRole.update).mock.calls[0][0].data.deletedAt).toBeInstanceOf(Date)
    expect(asMock(prisma.user.update).mock.calls[0][0]).toMatchObject({
      where: { id: 'u2' },
      data: { sessionEpoch: { increment: 1 } },
    })
    // The admin lookup is pinned to the org the admin is acting in.
    expect(asMock(prisma.userOrgRole.findFirst).mock.calls[0][0].where).toMatchObject({
      orgId: 'org1',
      deletedAt: null,
    })
  })

  it('treats an already-removed member as not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin1', activeOrgId: 'org1' } })
    asMock(prisma.userOrgRole.findFirst)
      .mockResolvedValueOnce({ userId: 'admin1', orgId: 'org1', role: 'ORG_ADMIN' })
      .mockResolvedValueOnce(null)

    const res = await removeMember(new Request('http://localhost/api/x', { method: 'DELETE' }), {
      params: { userId: 'u2' },
    })

    expect(res.status).toBe(404)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('A3 — PUT /api/jobs/[id] validates cross-org foreign keys', () => {
  it('rejects an assessmentId from another organisation', async () => {
    asMock(prisma.job.findFirst).mockResolvedValue(existingJob())
    asMock(prisma.assessment.findFirst).mockResolvedValue(null)

    const res = await putJob(
      jsonReq('PUT', 'http://localhost/api/jobs/job1', { assessmentId: 'foreign-assessment' }),
      { params: { id: 'job1' } },
    )

    expect(res.status).toBe(400)
    expect(asMock(prisma.assessment.findFirst).mock.calls[0][0].where).toEqual({
      id: 'foreign-assessment',
      orgId: 'org1',
      deletedAt: null,
    })
    expect(prisma.job.update).not.toHaveBeenCalled()
  })

  it('accepts an assessment owned by the job’s organisation', async () => {
    asMock(prisma.job.findFirst).mockResolvedValue(existingJob())
    asMock(prisma.assessment.findFirst).mockResolvedValue({ id: 'own-assessment' })
    asMock(prisma.job.update).mockResolvedValue({ id: 'job1' })

    const res = await putJob(
      jsonReq('PUT', 'http://localhost/api/jobs/job1', { assessmentId: 'own-assessment' }),
      { params: { id: 'job1' } },
    )

    expect(res.status).toBe(200)
    expect(asMock(prisma.job.update).mock.calls[0][0].data.assessmentId).toBe('own-assessment')
  })

  it('rejects an assignedRecruiterId who is not a live member of the org', async () => {
    asMock(prisma.job.findFirst).mockResolvedValue(existingJob())
    asMock(prisma.userOrgRole.findFirst).mockResolvedValue(null)

    const res = await putJob(
      jsonReq('PUT', 'http://localhost/api/jobs/job1', { assignedRecruiterId: 'outsider' }),
      { params: { id: 'job1' } },
    )

    expect(res.status).toBe(400)
    expect(asMock(prisma.userOrgRole.findFirst).mock.calls[0][0].where).toEqual({
      userId: 'outsider',
      orgId: 'org1',
      deletedAt: null,
    })
    expect(prisma.job.update).not.toHaveBeenCalled()
  })
})

describe('A4 — PATCH interview validates branch ownership', () => {
  const interview = { id: 'int1', applicationId: 'app1', orgId: 'org1', status: 'SCHEDULED' }
  const patch = (branchId: string) =>
    patchInterview(
      jsonReq('PATCH', 'http://localhost/api/applications/app1/interviews/int1', { branchId }),
      { params: { id: 'app1', interviewId: 'int1' } },
    )

  it('rejects a branch belonging to another organisation', async () => {
    asMock(prisma.interview.findFirst).mockResolvedValue(interview)
    asMock(prisma.userOrgRole.findFirst).mockResolvedValue({ userId: 'u1' })
    asMock(prisma.branch.findUnique).mockResolvedValue({
      id: 'b-foreign',
      orgId: 'org2',
      deletedAt: null,
    })

    const res = await patch('b-foreign')

    expect(res.status).toBe(400)
    expect(prisma.interview.update).not.toHaveBeenCalled()
  })

  it('accepts a branch of the interview’s own organisation', async () => {
    asMock(prisma.interview.findFirst).mockResolvedValue(interview)
    asMock(prisma.userOrgRole.findFirst).mockResolvedValue({ userId: 'u1' })
    asMock(prisma.branch.findUnique).mockResolvedValue({ id: 'b1', orgId: 'org1', deletedAt: null })
    asMock(prisma.interview.update).mockResolvedValue({ id: 'int1', scheduledAt: new Date() })

    const res = await patch('b1')

    expect(res.status).toBe(200)
    expect(asMock(prisma.interview.update).mock.calls[0][0].data.branchId).toBe('b1')
  })

  it('does not honour the membership of a removed member', async () => {
    asMock(prisma.interview.findFirst).mockResolvedValue(interview)
    asMock(prisma.userOrgRole.findFirst).mockResolvedValue(null)

    const res = await patch('b1')

    expect(res.status).toBe(404)
    expect(asMock(prisma.userOrgRole.findFirst).mock.calls[0][0].where.deletedAt).toBeNull()
  })
})
