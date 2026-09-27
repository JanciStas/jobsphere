/**
 * Authorisation pins for the application server actions.
 *
 * Unlike the job actions, these are already at parity with their API twins:
 * PATCH /api/applications/[id] also authorises on bare organisation membership,
 * with no role requirement. That is the codebase's policy, so this suite pins it
 * rather than tightening it — a change of policy belongs in a PR that changes
 * both doors at once, not in a test.
 *
 * What the suite does enforce is the tenant boundary and, for deleteApplication,
 * candidate ownership: an application may only be withdrawn by the candidate who
 * owns it, resolved via Candidate.userId rather than candidateId.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth }))

const { getOrCreateCandidateForUser } = vi.hoisted(() => ({
  getOrCreateCandidateForUser: vi.fn(),
}))
vi.mock('@/lib/identity', () => ({ getOrCreateCandidateForUser }))

const { addEmailSequenceJob } = vi.hoisted(() => ({
  addEmailSequenceJob: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/queue', () => ({ addEmailSequenceJob }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    job: { findUnique: vi.fn() },
    application: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    applicationActivity: { create: vi.fn(), deleteMany: vi.fn() },
    interview: { deleteMany: vi.fn() },
    userOrgRole: { findFirst: vi.fn() },
    emailSequence: { findFirst: vi.fn() },
    emailSequenceRun: { create: vi.fn() },
    // deleteApplication deletes RESTRICT children through the batch form; the
    // mock resolves the already-built operations together, like the real client.
    $transaction: vi.fn((operations: unknown[]) => Promise.all(operations)),
  },
}))

import {
  createApplication,
  updateApplicationStatus,
  deleteApplication,
  addApplicationNote,
} from '../applications'
import { prisma } from '@/lib/prisma'

const SESSION = { user: { id: 'user-1' } }
const CANDIDATE_ID = 'cand-1'
// A real cuid — createApplicationSchema validates the shape before anything else.
const JOB_ID = 'clh1234567890abcdefghijkl'

const APPLICATION = {
  id: 'app-1',
  stage: 'NEW',
  candidateId: CANDIDATE_ID,
  job: { id: JOB_ID, orgId: 'org-1' },
  candidate: { userId: 'user-1' },
}

function expectNoWrites() {
  expect(prisma.application.create).not.toHaveBeenCalled()
  expect(prisma.application.update).not.toHaveBeenCalled()
  expect(prisma.application.delete).not.toHaveBeenCalled()
  expect(prisma.applicationActivity.create).not.toHaveBeenCalled()
  expect(prisma.applicationActivity.deleteMany).not.toHaveBeenCalled()
  expect(prisma.interview.deleteMany).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue(SESSION)
  getOrCreateCandidateForUser.mockResolvedValue({ id: CANDIDATE_ID })
  ;(prisma.job.findUnique as any).mockResolvedValue({ orgId: 'org-1' })
  ;(prisma.application.findFirst as any).mockResolvedValue(null)
  ;(prisma.application.findUnique as any).mockResolvedValue(APPLICATION)
  ;(prisma.application.create as any).mockResolvedValue({ id: 'app-1' })
  ;(prisma.application.update as any).mockResolvedValue({ id: 'app-1', stage: 'SCREENING' })
  ;(prisma.application.delete as any).mockResolvedValue({ id: 'app-1' })
  ;(prisma.applicationActivity.create as any).mockResolvedValue({ id: 'act-1' })
  ;(prisma.userOrgRole.findFirst as any).mockResolvedValue({ userId: 'user-1', orgId: 'org-1' })
  ;(prisma.emailSequence.findFirst as any).mockResolvedValue(null)
})

describe.each([
  ['createApplication', () => createApplication({ jobId: JOB_ID, coverLetter: 'hi' })],
  ['updateApplicationStatus', () => updateApplicationStatus('app-1', 'SCREENING')],
  ['deleteApplication', () => deleteApplication('app-1')],
  ['addApplicationNote', () => addApplicationNote('app-1', 'a note')],
] as const)('%s', (_name, invoke) => {
  it('rejects an anonymous caller and writes nothing', async () => {
    auth.mockResolvedValue(null)
    await expect(invoke()).rejects.toThrow('Unauthorized')
    expectNoWrites()
  })
})

describe('employer-side actions enforce the tenant boundary', () => {
  it.each([
    ['updateApplicationStatus', () => updateApplicationStatus('app-1', 'SCREENING')],
    ['addApplicationNote', () => addApplicationNote('app-1', 'a note')],
  ] as const)('%s refuses a caller from another organisation', async (_n, invoke) => {
    ;(prisma.userOrgRole.findFirst as any).mockResolvedValue(null)
    await expect(invoke()).rejects.toThrow('Forbidden')
    expectNoWrites()
  })

  it.each([
    ['updateApplicationStatus', () => updateApplicationStatus('app-1', 'SCREENING')],
    ['addApplicationNote', () => addApplicationNote('app-1', 'a note')],
  ] as const)('%s scopes the membership lookup to the job orgId', async (_n, invoke) => {
    await invoke()
    expect(prisma.userOrgRole.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', orgId: 'org-1' },
    })
  })

  it.each([
    ['updateApplicationStatus', () => updateApplicationStatus('app-1', 'SCREENING')],
    ['addApplicationNote', () => addApplicationNote('app-1', 'a note')],
  ] as const)('%s refuses when the application does not exist', async (_n, invoke) => {
    ;(prisma.application.findUnique as any).mockResolvedValue(null)
    await expect(invoke()).rejects.toThrow('Application not found')
    expectNoWrites()
  })
})

describe('deleteApplication — candidate ownership', () => {
  it('refuses a different user, even one in the same organisation', async () => {
    ;(prisma.application.findUnique as any).mockResolvedValue({
      ...APPLICATION,
      candidate: { userId: 'someone-else' },
    })
    await expect(deleteApplication('app-1')).rejects.toThrow('Forbidden')
    expectNoWrites()
  })

  it('refuses an employer of the owning organisation', async () => {
    // Ownership is the candidate's, not the org's: a recruiter must not be able
    // to withdraw an application on the candidate's behalf.
    ;(prisma.application.findUnique as any).mockResolvedValue({
      ...APPLICATION,
      candidate: { userId: 'the-candidate' },
    })
    ;(prisma.userOrgRole.findFirst as any).mockResolvedValue({ role: 'ORG_ADMIN' })
    await expect(deleteApplication('app-1')).rejects.toThrow('Forbidden')
    expectNoWrites()
  })

  it('allows the owning candidate', async () => {
    await expect(deleteApplication('app-1')).resolves.toEqual({ success: true })
    // Activities and interviews hold ON DELETE RESTRICT keys to the application,
    // so a withdrawal removes them first — inside one transaction, so a partial
    // failure leaves the application in place.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1)
    expect(prisma.applicationActivity.deleteMany).toHaveBeenCalledWith({
      where: { applicationId: 'app-1' },
    })
    expect(prisma.interview.deleteMany).toHaveBeenCalledWith({
      where: { applicationId: 'app-1' },
    })
    expect(prisma.application.delete).toHaveBeenCalledWith({ where: { id: 'app-1' } })
  })
})

describe('createApplication', () => {
  it('validates the payload before writing', async () => {
    await expect(createApplication({ jobId: 'not-a-cuid', coverLetter: 'hi' })).rejects.toThrow()
    expectNoWrites()
  })

  it('rejects an over-long cover letter', async () => {
    await expect(
      createApplication({ jobId: JOB_ID, coverLetter: 'x'.repeat(5001) }),
    ).rejects.toThrow()
    expectNoWrites()
  })

  it('refuses to apply to a job that does not exist', async () => {
    ;(prisma.job.findUnique as any).mockResolvedValue(null)
    await expect(createApplication({ jobId: JOB_ID, coverLetter: 'hi' })).rejects.toThrow(
      'Job not found',
    )
    expectNoWrites()
  })

  it('refuses a duplicate application', async () => {
    ;(prisma.application.findFirst as any).mockResolvedValue({ id: 'existing' })
    await expect(createApplication({ jobId: JOB_ID, coverLetter: 'hi' })).rejects.toThrow(
      'already applied',
    )
    expectNoWrites()
  })

  it('resolves the candidate inside the job organisation, not globally', async () => {
    // A candidate record is org-scoped; applying to another org's job must not
    // reuse the candidate row from the first one.
    await createApplication({ jobId: JOB_ID, coverLetter: 'hi' })
    expect(getOrCreateCandidateForUser).toHaveBeenCalledWith('user-1', 'org-1')
    expect(prisma.application.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ candidateId: CANDIDATE_ID, orgId: 'org-1' }),
      }),
    )
  })
})

describe('updateApplicationStatus', () => {
  it('records a stage-change activity attributed to the acting user', async () => {
    await updateApplicationStatus('app-1', 'SCREENING')
    expect(prisma.applicationActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'STAGE_CHANGED', performedBy: 'user-1' }),
      }),
    )
  })

  it('does not log an activity when the stage is unchanged', async () => {
    await updateApplicationStatus('app-1', 'NEW')
    expect(prisma.applicationActivity.create).not.toHaveBeenCalled()
  })

  it('still updates the application when sequence auto-enrolment fails', async () => {
    ;(prisma.emailSequence.findFirst as any).mockRejectedValue(new Error('db down'))
    await expect(updateApplicationStatus('app-1', 'INTERVIEWED')).resolves.toBeDefined()
    expect(prisma.application.update).toHaveBeenCalled()
  })
})
