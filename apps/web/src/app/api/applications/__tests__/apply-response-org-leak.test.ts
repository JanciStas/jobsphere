import { describe, it, expect, vi, beforeEach } from 'vitest'

// Security wrappers are pass-through in unit tests.
vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: unknown) => h }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (h: unknown) => h }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/identity', () => ({
  getOrCreateCandidateForUser: vi.fn(),
  getPersonalCandidateForUser: vi.fn(),
}))
vi.mock('@/lib/assessment-invite', () => ({ createOrGetAssessmentInvite: vi.fn() }))
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn(),
  getApplicationReceivedEmail: vi.fn(() => '<html></html>'),
  getNewApplicationEmail: vi.fn(() => '<html></html>'),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    job: { findUnique: vi.fn() },
    application: { findFirst: vi.fn(), create: vi.fn() },
    applicationActivity: { create: vi.fn() },
    userOrgRole: { findFirst: vi.fn() },
  },
}))

import { POST } from '../route'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getOrCreateCandidateForUser } from '@/lib/identity'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

const JOB_ID = 'clxjob000000000000000000a'
const req = (body: unknown) =>
  new Request('http://localhost/api/applications', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  vi.clearAllMocks()
  asMock(auth).mockResolvedValue({ user: { id: 'u1', email: 'a@b.co', name: 'Applicant' } })
  asMock(getOrCreateCandidateForUser).mockResolvedValue({ id: 'cand1' })
  asMock(prisma.job.findUnique).mockResolvedValue({
    orgId: 'org-from-job',
    status: 'PUBLISHED',
    requiresAssessment: false,
    assessmentId: null,
  })
  asMock(prisma.application.findFirst).mockResolvedValue(null)
  asMock(prisma.application.create).mockResolvedValue({
    id: 'app1',
    job: { title: 'Dev', orgId: 'org-from-job', organization: { name: 'Acme' } },
  })
  asMock(prisma.applicationActivity.create).mockResolvedValue({})
  asMock(prisma.userOrgRole.findFirst).mockResolvedValue(null)
})

describe('POST /api/applications — authorization and tenant derivation', () => {
  it('returns 401 for an anonymous caller and creates nothing', async () => {
    asMock(auth).mockResolvedValue(null)
    const res = await POST(req({ jobId: JOB_ID, coverLetter: 'hello' }))
    expect(res.status).toBe(401)
    expect(prisma.application.create).not.toHaveBeenCalled()
  })

  it('derives orgId from the job, ignoring a client-supplied orgId', async () => {
    const res = await POST(req({ jobId: JOB_ID, coverLetter: 'hello', orgId: 'evil-org' }))
    expect(res.status).toBe(201)
    expect(getOrCreateCandidateForUser).toHaveBeenCalledWith('u1', 'org-from-job')
    const data = asMock(prisma.application.create).mock.calls[0][0].data
    expect(data.orgId).toBe('org-from-job')
  })

  it('answers 409 when the user already applied to the job', async () => {
    asMock(prisma.application.findFirst).mockResolvedValue({ id: 'existing' })
    const res = await POST(req({ jobId: JOB_ID, coverLetter: 'hello' }))
    expect(res.status).toBe(409)
    expect(prisma.application.create).not.toHaveBeenCalled()
  })

  it('answers 409 (not 500) on a concurrent-apply unique violation', async () => {
    asMock(prisma.application.create).mockRejectedValue(
      Object.assign(new Error('x'), { code: 'P2002' }),
    )
    const res = await POST(req({ jobId: JOB_ID, coverLetter: 'hello' }))
    expect(res.status).toBe(409)
  })

  it('does not hand the whole Organization row (settings/features) back to the applicant', async () => {
    await POST(req({ jobId: JOB_ID, coverLetter: 'hello' }))
    const include = asMock(prisma.application.create).mock.calls[0][0].include
    const org = include.job.select.organization
    // `organization: true` would return Organization.settings, which holds every
    // org member's private userPreferences, plus the internal `features` blob.
    expect(org).not.toBe(true)
    expect(org.select).toBeDefined()
    expect(org.select.settings).toBeUndefined()
    expect(org.select.features).toBeUndefined()
    expect(org.select.name).toBe(true)
  })

  it('does not return the whole Job row (internal fields) to the applicant', async () => {
    await POST(req({ jobId: JOB_ID, coverLetter: 'hello' }))
    const job = asMock(prisma.application.create).mock.calls[0][0].include.job
    // include:{...} / true would add pipeline, assignedRecruiterId, createdBy, ...
    expect(job.include).toBeUndefined()
    expect(job.select).toBeDefined()
    expect(job.select.createdBy).toBeUndefined()
    expect(job.select.pipeline).toBeUndefined()
    expect(job.select.assignedRecruiterId).toBeUndefined()
    // fields the email branch needs
    expect(job.select.title).toBe(true)
    expect(job.select.orgId).toBe(true)
  })
})
