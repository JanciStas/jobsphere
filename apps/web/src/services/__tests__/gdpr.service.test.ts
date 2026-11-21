import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GdprService } from '../gdpr.service'
import { prisma } from '@/lib/prisma'
import { getCandidateIdsForUser } from '@/lib/identity'
import { deleteCV } from '@/lib/cv-storage'
import { createAuditLog } from '@/lib/audit-log'
import { AppError } from '@/lib/errors'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), delete: vi.fn() },
    candidateDocument: { findMany: vi.fn(), deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/identity', () => ({
  getCandidateIdsForUser: vi.fn(),
}))

vi.mock('@/lib/cv-storage', () => ({
  deleteCV: vi.fn(),
}))

vi.mock('@/lib/audit-log', () => ({
  createAuditLog: vi.fn(),
}))

/**
 * Build a transaction-client stub whose delete/find methods all record the
 * relative order in which they were invoked, so we can assert FK-safe ordering.
 */
function makeTxStub(order: string[]) {
  const rec =
    (label: string, ret: any = { count: 0 }) =>
    (..._args: any[]) => {
      order.push(label)
      return Promise.resolve(ret)
    }

  return {
    application: {
      findMany: vi.fn().mockResolvedValue([{ id: 'app1' }]),
      deleteMany: vi.fn(rec('application')),
      updateMany: vi.fn(),
    },
    job: { count: vi.fn().mockResolvedValue(0) },
    gig: { count: vi.fn().mockResolvedValue(0) },
    resume: {
      findMany: vi.fn().mockResolvedValue([{ id: 'res1' }]),
      deleteMany: vi.fn(rec('resume')),
    },
    assessmentInvite: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(rec('assessmentInvite')),
    },
    attempt: { findMany: vi.fn().mockResolvedValue([]), deleteMany: vi.fn(rec('attempt')) },
    emailSequenceRun: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn(rec('emailSequenceRun')),
    },
    applicationActivity: { deleteMany: vi.fn(rec('applicationActivity')) },
    resumeSection: { deleteMany: vi.fn(rec('resumeSection')) },
    answer: { deleteMany: vi.fn(rec('answer')) },
    emailSequenceEvent: { deleteMany: vi.fn(rec('emailSequenceEvent')) },
    matchScore: { deleteMany: vi.fn(rec('matchScore')) },
    candidateDocument: { deleteMany: vi.fn(rec('candidateDocument')) },
    candidateContact: { deleteMany: vi.fn(rec('candidateContact')) },
    consentRecord: { deleteMany: vi.fn(rec('consentRecord')) },
    candidate: { deleteMany: vi.fn(rec('candidate')) },
    auditLog: { deleteMany: vi.fn(rec('auditLog')) },
    savedJob: { deleteMany: vi.fn(rec('savedJob')) },
    notification: { deleteMany: vi.fn(rec('notification')) },
    dSARRequest: { deleteMany: vi.fn(rec('dSARRequest')) },
    session: { deleteMany: vi.fn(rec('session')) },
    account: { deleteMany: vi.fn(rec('account')) },
    userOrgRole: { deleteMany: vi.fn(rec('userOrgRole')) },
    user: { delete: vi.fn(rec('user', {})), update: vi.fn(rec('userAnonymize', {})) },
  }
}

describe('GdprService.eraseUserData', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws 404 when the user does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as any)
    await expect(GdprService.eraseUserData('missing')).rejects.toThrow(AppError)
    await expect(GdprService.eraseUserData('missing')).rejects.toThrow('User not found')
  })

  it('erases candidate PII in FK-safe order, then user-scoped data, then the user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1',
      email: 'jane@example.com',
    } as any)
    vi.mocked(getCandidateIdsForUser).mockResolvedValue(['c1'])
    vi.mocked(prisma.candidateDocument.findMany).mockResolvedValue([
      { uri: 'https://blob/cv1.pdf' },
    ] as any)
    vi.mocked(deleteCV).mockResolvedValue(true)

    const order: string[] = []
    const tx = makeTxStub(order)
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx))

    const result = await GdprService.eraseUserData('u1')

    // Children deleted before their parents.
    expect(order.indexOf('applicationActivity')).toBeLessThan(order.indexOf('application'))
    expect(order.indexOf('resumeSection')).toBeLessThan(order.indexOf('resume'))
    expect(order.indexOf('matchScore')).toBeLessThan(order.indexOf('resume'))
    // Resume deleted before the document it points at (sourceDocumentId).
    expect(order.indexOf('resume')).toBeLessThan(order.indexOf('candidateDocument'))
    // All candidate children deleted before the candidate row.
    expect(order.indexOf('application')).toBeLessThan(order.indexOf('candidate'))
    expect(order.indexOf('candidateContact')).toBeLessThan(order.indexOf('candidate'))
    expect(order.indexOf('candidateDocument')).toBeLessThan(order.indexOf('candidate'))
    // User deleted last of all.
    expect(order[order.length - 1]).toBe('user')

    // Blob storage cleaned up after commit.
    expect(deleteCV).toHaveBeenCalledWith('https://blob/cv1.pdf')
    expect(result.candidateIds).toEqual(['c1'])
    expect(result.blobsDeleted).toBe(1)

    // Audited.
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        resource: 'USER',
        resourceId: 'u1',
        metadata: expect.objectContaining({ reason: 'GDPR_ERASURE' }),
      }),
    )
  })

  it('handles users with no candidate rows (no blob cleanup, still deletes user)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u2', email: 'x@y.z' } as any)
    vi.mocked(getCandidateIdsForUser).mockResolvedValue([])

    const order: string[] = []
    const tx = makeTxStub(order)
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx))

    const result = await GdprService.eraseUserData('u2')

    expect(prisma.candidateDocument.findMany).not.toHaveBeenCalled()
    expect(deleteCV).not.toHaveBeenCalled()
    expect(order[order.length - 1]).toBe('user')
    expect(result.candidateIds).toEqual([])
    expect(result.blobsDeleted).toBe(0)
  })

  it('anonymizes (not hard-deletes) a user who authored jobs, and detaches assignments (F3)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u3', email: 'boss@org.z' } as any)
    vi.mocked(getCandidateIdsForUser).mockResolvedValue([])

    const order: string[] = []
    const tx = makeTxStub(order)
    tx.job.count.mockResolvedValue(2) // this user created jobs (Restrict FK)
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx))

    await GdprService.eraseUserData('u3')

    // assignedTo applications detached, user anonymized via update, NOT hard-deleted.
    expect(tx.application.updateMany).toHaveBeenCalledWith({
      where: { assignedTo: 'u3' },
      data: { assignedTo: null },
    })
    expect(tx.user.update).toHaveBeenCalledTimes(1)
    expect(tx.user.delete).not.toHaveBeenCalled()
    const anonData = tx.user.update.mock.calls[0][0].data
    expect(anonData.email).toBe('erased-u3@deleted.invalid')
    expect(anonData.name).toBeNull()
    expect(anonData.password).toBeNull()
    expect(anonData.deletedAt).toBeInstanceOf(Date)
    // No PII left on the tombstone (F3): IP/login/verification all erased.
    expect(anonData.lastLoginIp).toBeNull()
    expect(anonData.lastLoginAt).toBeNull()
    expect(anonData.emailVerified).toBeNull()
  })

  it('anonymizes a gig author with no jobs instead of hitting the Gig.createdBy FK', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u4', email: 'agency@org.z' } as any)
    vi.mocked(getCandidateIdsForUser).mockResolvedValue([])

    const tx = makeTxStub([])
    tx.gig.count.mockResolvedValue(1)
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx))

    await GdprService.eraseUserData('u4')

    expect(tx.user.update).toHaveBeenCalledTimes(1)
    expect(tx.user.delete).not.toHaveBeenCalled()
  })
})
