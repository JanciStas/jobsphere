/**
 * GDPR Service
 *
 * Implements the Right to Erasure (GDPR Art. 17) execution path for a job-seeker
 * `User` and all of their candidate-side PII across every organization.
 *
 * Deletion MUST happen in FK-safe order: every child relation in the schema uses
 * Prisma's default `onDelete: Restrict`, so a parent row cannot be removed while
 * children still reference it. The order below deletes leaves first, walking up
 * to the `Candidate`, and finally the `User`.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { deleteCV } from '@/lib/cv-storage'
import { getCandidateIdsForUser } from '@/lib/identity'
import { createAuditLog } from '@/lib/audit-log'
import { AppError } from '@/lib/errors'
import { logger } from '@/lib/logger'
import { BULK_TX_OPTIONS } from '@/lib/transaction-options'

type Tx = Prisma.TransactionClient

export interface EraseUserResult {
  userId: string
  candidateIds: string[]
  documentsDeleted: number
  blobsDeleted: number
  applicationsDeleted: number
  resumesDeleted: number
}

/**
 * Erase all PII for the candidate rows identified by `candidateIds`, in FK-safe
 * order. Runs inside the caller's transaction. Returns counts for auditing.
 *
 * NOTE: Blob (file) deletion is intentionally NOT done here — it is a best-effort
 * side effect performed by the caller AFTER the transaction commits, because blob
 * deletes are network calls that must not roll back / block the DB transaction.
 */
async function eraseCandidateRows(
  tx: Tx,
  candidateIds: string[],
): Promise<{ applicationsDeleted: number; resumesDeleted: number; documentsDeleted: number }> {
  if (candidateIds.length === 0) {
    return { applicationsDeleted: 0, resumesDeleted: 0, documentsDeleted: 0 }
  }

  const inCandidates = { candidateId: { in: candidateIds } }

  // Resolve dependent parent ids up front (needed to scope grandchild deletes).
  const applications = await tx.application.findMany({
    where: inCandidates,
    select: { id: true },
  })
  const applicationIds = applications.map((a) => a.id)

  const resumes = await tx.resume.findMany({
    where: inCandidates,
    select: { id: true },
  })
  const resumeIds = resumes.map((r) => r.id)

  const attempts = await tx.attempt.findMany({
    where: inCandidates,
    select: { id: true },
  })
  const attemptIds = attempts.map((a) => a.id)

  const runs = await tx.emailSequenceRun.findMany({
    where: inCandidates,
    select: { id: true },
  })
  const runIds = runs.map((r) => r.id)

  // --- Level 3: grandchildren / leaf rows -------------------------------------
  if (applicationIds.length > 0) {
    await tx.applicationActivity.deleteMany({
      where: { applicationId: { in: applicationIds } },
    })
  }
  if (resumeIds.length > 0) {
    await tx.resumeSection.deleteMany({ where: { resumeId: { in: resumeIds } } })
  }
  if (attemptIds.length > 0) {
    await tx.answer.deleteMany({ where: { attemptId: { in: attemptIds } } })
  }
  if (runIds.length > 0) {
    await tx.emailSequenceEvent.deleteMany({ where: { runId: { in: runIds } } })
  }

  // --- Level 2: rows referencing Candidate (and each other) -------------------
  // MatchScore references both candidateId AND resumeId → delete before Resume.
  await tx.matchScore.deleteMany({ where: inCandidates })
  // Attempt references AssessmentInvite → delete Attempt before AssessmentInvite.
  await tx.attempt.deleteMany({ where: inCandidates })
  await tx.assessmentInvite.deleteMany({ where: inCandidates })
  await tx.emailSequenceRun.deleteMany({ where: inCandidates })
  const { count: applicationsDeleted } = await tx.application.deleteMany({ where: inCandidates })
  // Resume references CandidateDocument (sourceDocumentId) → delete Resume first.
  const { count: resumesDeleted } = await tx.resume.deleteMany({ where: inCandidates })
  const { count: documentsDeleted } = await tx.candidateDocument.deleteMany({ where: inCandidates })
  await tx.candidateContact.deleteMany({ where: inCandidates })
  await tx.consentRecord.deleteMany({ where: inCandidates })

  // --- Level 1: the Candidate rows themselves ---------------------------------
  await tx.candidate.deleteMany({ where: { id: { in: candidateIds } } })

  return { applicationsDeleted, resumesDeleted, documentsDeleted }
}

export class GdprService {
  /**
   * Execute Right to Erasure for a user: hard-delete all candidate-side PII and
   * the user account itself, in FK-safe order. Idempotent-ish (safe to re-run;
   * subsequent runs simply find nothing to delete and the user no longer exists).
   *
   * Returns counts for the audit trail. Throws `AppError(404)` if the user does
   * not exist.
   */
  static async eraseUserData(userId: string): Promise<EraseUserResult> {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      throw new AppError('User not found', 404)
    }

    const candidateIds = await getCandidateIdsForUser(userId)

    // Collect blob URIs BEFORE deleting the rows so we can clean storage after commit.
    const blobUris =
      candidateIds.length > 0
        ? (
            await prisma.candidateDocument.findMany({
              where: { candidateId: { in: candidateIds } },
              select: { uri: true },
            })
          )
            .map((d) => d.uri)
            .filter((uri): uri is string => Boolean(uri))
        : []

    const counts = await prisma.$transaction(async (tx) => {
      const candidateCounts = await eraseCandidateRows(tx, candidateIds)

      // User-scoped PII not covered by the candidate sweep (no cascade on these).
      await tx.consentRecord.deleteMany({ where: { userId } })
      await tx.auditLog.deleteMany({ where: { userId } })
      await tx.savedJob.deleteMany({ where: { userId } })
      await tx.notification.deleteMany({ where: { userId } })
      await tx.dSARRequest.deleteMany({ where: { userId } })

      // Reuse the corrected base deleteUser path (sessions + userOrgRole + user).
      // Account & Session cascade on User, but we clear sessions/roles explicitly
      // to mirror UserService.deleteUser and stay deterministic.
      await tx.session.deleteMany({ where: { userId } })
      await tx.account.deleteMany({ where: { userId } })
      await tx.userOrgRole.deleteMany({ where: { userId } })

      // Detach the user from org resources whose FKs would otherwise block deletion (F3).
      // Application.assignedTo is nullable → null it.
      await tx.application.updateMany({
        where: { assignedTo: userId },
        data: { assignedTo: null },
      })

      // Job.createdBy is a REQUIRED FK (Restrict): if this user authored jobs we cannot
      // hard-delete the row without orphaning them. Anonymize instead — all PII is erased
      // and the row is kept as an empty tombstone so the FK stays valid (GDPR Art.17 still
      // satisfied: no personal data remains). Pure job-seekers (no authored jobs) are hard-deleted.
      // Gig.createdBy is the same kind of required FK, so a gig author is tombstoned too.
      const authoredJobs = await tx.job.count({ where: { createdBy: userId } })
      const authoredGigs = await tx.gig.count({ where: { createdBy: userId } })
      if (authoredJobs + authoredGigs > 0) {
        await tx.user.update({
          where: { id: userId },
          data: {
            email: `erased-${userId}@deleted.invalid`,
            name: null,
            phone: null,
            avatar: null,
            password: null,
            totpSecret: null,
            totpEnabled: false,
            // PII that must also be erased on the tombstone (an IP is personal data
            // under GDPR Recital 30 / Breyer) — review F3 follow-up.
            lastLoginIp: null,
            lastLoginAt: null,
            emailVerified: null,
            sessionEpoch: { increment: 1 },
            deletedAt: new Date(),
          },
        })
      } else {
        await tx.user.delete({ where: { id: userId } })
      }

      return candidateCounts
      // BULK_TX_OPTIONS, not Prisma's 5s default: this erases one user's entire
      // footprint — every candidate row they map to, plus documents, resumes,
      // applications, consents, audit logs, saved jobs, notifications and DSAR
      // records. For anyone with real history that exceeds five seconds, and the
      // failure mode is P2028, which the DSAR route correctly refuses to report as
      // a completed erasure — so the request stalls instead of finishing.
    }, BULK_TX_OPTIONS)

    // Best-effort blob deletion AFTER the DB transaction has committed.
    let blobsDeleted = 0
    for (const uri of blobUris) {
      try {
        const ok = await deleteCV(uri)
        if (ok) blobsDeleted += 1
      } catch (error) {
        logger.error('GDPR erasure: failed to delete blob', { uri, error })
      }
    }

    // Audit the erasure (orgId SYSTEM — the user/orgs are gone now).
    try {
      await createAuditLog({
        userId: 'SYSTEM',
        orgId: 'SYSTEM',
        action: 'DELETE',
        resource: 'USER',
        resourceId: userId,
        metadata: {
          reason: 'GDPR_ERASURE',
          email: user.email,
          candidateIds,
          documentsDeleted: counts.documentsDeleted,
          blobsDeleted,
        },
      })
    } catch (error) {
      logger.error('GDPR erasure: failed to write audit log', { userId, error })
    }

    return {
      userId,
      candidateIds,
      documentsDeleted: counts.documentsDeleted,
      blobsDeleted,
      applicationsDeleted: counts.applicationsDeleted,
      resumesDeleted: counts.resumesDeleted,
    }
  }
}

/**
 * Standalone, client-injectable variant of the candidate erasure sweep, exported
 * for reuse by the retention worker (which runs in a separate package against the
 * `@jobsphere/db` Prisma client and cannot import the web `@/` alias).
 *
 * Given a list of candidate ids, deletes all of their PII in FK-safe order inside
 * the provided transaction client. Does NOT touch the User or storage blobs.
 */
export async function eraseCandidatesPII(
  tx: Tx | PrismaClient,
  candidateIds: string[],
): Promise<void> {
  await eraseCandidateRows(tx as Tx, candidateIds)
}
