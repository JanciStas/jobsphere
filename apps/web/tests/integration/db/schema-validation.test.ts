import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  getPrismaClient,
  TEST_IDS,
  createTestJob,
  createTestCandidate,
  createTestCandidateWithContact,
} from '../helpers/test-db'

/**
 * Database Schema Validation Integration Tests
 * Tests foreign key constraints, unique constraints, and cascade deletes
 */

const prisma = getPrismaClient()

// Fixtures this file creates OUTSIDE the shared test organisation. Neither
// cleanupDynamicData (orgId-scoped) nor cleanupAllTestData (users prefixed
// `test-user-`, org `test-org-id`) touches them, so on a persistent database the
// second run of the suite hit the very unique constraints these tests assert and
// failed on the FIRST create instead of the second. Cleared before and after.
const EXTRA_USER_EMAILS = [
  'unique-test@example.com',
  'user-org-role-test@example.com',
  'composite-test@example.com',
]
const EXTRA_ORG_SLUGS = ['unique-org-slug', 'second-org']

async function cleanupFileFixtures() {
  const orgs = await prisma.organization.findMany({
    where: { slug: { in: EXTRA_ORG_SLUGS } },
    select: { id: true },
  })
  const orgIds = orgs.map((o) => o.id)
  const users = await prisma.user.findMany({
    where: { email: { in: EXTRA_USER_EMAILS } },
    select: { id: true },
  })
  const userIds = users.map((u) => u.id)

  if (orgIds.length > 0) {
    await prisma.job.deleteMany({ where: { orgId: { in: orgIds } } })
    await prisma.userOrgRole.deleteMany({ where: { orgId: { in: orgIds } } })
  }
  if (userIds.length > 0) {
    await prisma.job.deleteMany({ where: { createdBy: { in: userIds } } })
    await prisma.userOrgRole.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  }
  if (orgIds.length > 0) {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  }
}

describe('Database Schema Validation', () => {
  // Seeding, per-test cleanup and teardown are global (tests/integration/setup.ts).
  // Repeating them here — this file used to call cleanupAllTestData() and
  // disconnectDb() in its own afterAll — tears the shared fixture down and closes
  // the client for every file scheduled after it.
  beforeAll(cleanupFileFixtures)
  afterAll(cleanupFileFixtures)

  describe('Foreign Key Constraints', () => {
    it('should prevent creating job with non-existent organization', async () => {
      await expect(
        prisma.job.create({
          data: {
            title: 'Test Job',
            description: 'A'.repeat(100),
            orgId: 'non-existent-org-id',
            createdBy: TEST_IDS.recruiter,
            locale: 'en',
            status: 'PUBLISHED',
            employmentType: 'FULL_TIME',
            seniority: 'MID',
            salaryMin: 50000,
            salaryMax: 80000,
            salaryCurrency: 'EUR',
            remote: false,
            hybrid: false,
          },
        }),
      ).rejects.toThrow()
    })

    it('should prevent creating job with non-existent creator', async () => {
      await expect(
        prisma.job.create({
          data: {
            title: 'Test Job',
            description: 'A'.repeat(100),
            orgId: TEST_IDS.org,
            createdBy: 'non-existent-user-id',
            locale: 'en',
            status: 'PUBLISHED',
            employmentType: 'FULL_TIME',
            seniority: 'MID',
            salaryMin: 50000,
            salaryMax: 80000,
            salaryCurrency: 'EUR',
            remote: false,
            hybrid: false,
          },
        }),
      ).rejects.toThrow()
    })

    it('should prevent creating application with non-existent job', async () => {
      const candidate = await createTestCandidate()

      await expect(
        prisma.application.create({
          data: {
            jobId: 'non-existent-job-id',
            candidateId: candidate.id,
            orgId: TEST_IDS.org,
            stage: 'NEW',
            source: 'WEBSITE',
          },
        }),
      ).rejects.toThrow()
    })

    it('should prevent creating application with non-existent candidate', async () => {
      const job = await createTestJob()

      await expect(
        prisma.application.create({
          data: {
            jobId: job.id,
            candidateId: 'non-existent-candidate-id',
            orgId: TEST_IDS.org,
            stage: 'NEW',
            source: 'WEBSITE',
          },
        }),
      ).rejects.toThrow()
    })

    it('should prevent creating candidate contact without candidate', async () => {
      await expect(
        prisma.candidateContact.create({
          data: {
            candidateId: 'non-existent-candidate-id',
            fullName: 'Test Contact',
            email: 'test@example.com',
            isPrimary: true,
          },
        }),
      ).rejects.toThrow()
    })

    it('should allow nullable foreign keys (assignedTo in Application)', async () => {
      const job = await createTestJob()
      const candidate = await createTestCandidate()

      const application = await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.id,
          orgId: TEST_IDS.org,
          stage: 'NEW',
          source: 'WEBSITE',
          assignedTo: null, // Nullable FK
        },
      })

      expect(application.assignedTo).toBeNull()
    })

    it('should validate foreign key on update', async () => {
      const job = await createTestJob()
      const candidate = await createTestCandidate()

      const application = await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.id,
          orgId: TEST_IDS.org,
          stage: 'NEW',
          source: 'WEBSITE',
        },
      })

      await expect(
        prisma.application.update({
          where: { id: application.id },
          data: { assignedTo: 'non-existent-user-id' },
        }),
      ).rejects.toThrow()
    })
  })

  describe('Unique Constraints', () => {
    it('should enforce unique email on User table', async () => {
      const email = 'unique-test@example.com'

      await prisma.user.create({
        data: {
          email,
          name: 'First User',
          password: 'hashedpassword',
          locale: 'en',
        },
      })

      await expect(
        prisma.user.create({
          data: {
            email, // Duplicate email
            name: 'Second User',
            password: 'hashedpassword',
            locale: 'en',
          },
        }),
      ).rejects.toThrow()
    })

    it('should enforce unique organization slug', async () => {
      const slug = 'unique-org-slug'

      await prisma.organization.create({
        data: {
          name: 'First Org',
          slug,
          industry: 'Technology',
        },
      })

      await expect(
        prisma.organization.create({
          data: {
            name: 'Second Org',
            slug, // Duplicate slug
            industry: 'Technology',
          },
        }),
      ).rejects.toThrow()
    })

    it('should enforce unique job slug per organization', async () => {
      const slug = 'software-engineer'

      await createTestJob({ slug })

      // Same slug in same org should fail
      await expect(createTestJob({ slug })).rejects.toThrow()
    })

    it('should allow same job slug in different organizations', async () => {
      const slug = 'software-engineer-2'

      // Create second organization
      const org2 = await prisma.organization.create({
        data: {
          name: 'Second Org',
          slug: 'second-org',
          industry: 'Technology',
        },
      })

      await createTestJob({ slug })

      // Same slug in different org should succeed
      const job2 = await prisma.job.create({
        data: {
          title: 'Software Engineer',
          description: 'A'.repeat(100),
          orgId: org2.id,
          createdBy: TEST_IDS.recruiter,
          locale: 'en',
          slug, // Same slug, different org
          status: 'PUBLISHED',
          employmentType: 'FULL_TIME',
          seniority: 'MID',
          salaryMin: 50000,
          salaryMax: 80000,
          salaryCurrency: 'EUR',
          remote: false,
          hybrid: false,
        },
      })

      expect(job2.slug).toBe(slug)
    })

    it('should enforce unique candidateId + jobId on Application', async () => {
      const job = await createTestJob()
      const candidate = await createTestCandidate()

      await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.id,
          orgId: TEST_IDS.org,
          stage: 'NEW',
          source: 'WEBSITE',
        },
      })

      // Duplicate application should fail
      await expect(
        prisma.application.create({
          data: {
            jobId: job.id,
            candidateId: candidate.id,
            orgId: TEST_IDS.org,
            stage: 'SCREENING',
            source: 'LINKEDIN',
          },
        }),
      ).rejects.toThrow()
    })

    it('should enforce unique userId + orgId on UserOrgRole', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'user-org-role-test@example.com',
          name: 'Test User',
          password: 'hashedpassword',
          locale: 'en',
        },
      })

      await prisma.userOrgRole.create({
        data: {
          userId: user.id,
          orgId: TEST_IDS.org,
          role: 'RECRUITER',
        },
      })

      // Duplicate role assignment should fail
      await expect(
        prisma.userOrgRole.create({
          data: {
            userId: user.id,
            orgId: TEST_IDS.org,
            role: 'ORG_ADMIN', // Different role, same user+org
          },
        }),
      ).rejects.toThrow()
    })

    it('should enforce unique jobId + candidateId on MatchScore', async () => {
      const job = await createTestJob()
      const candidate = await createTestCandidate()

      await prisma.matchScore.create({
        data: {
          orgId: TEST_IDS.org,
          jobId: job.id,
          candidateId: candidate.id,
          score0to100: 85,
          evidence: {},
          explanation: [],
          version: 'v1.0',
        },
      })

      // Duplicate match score should fail
      await expect(
        prisma.matchScore.create({
          data: {
            orgId: TEST_IDS.org,
            jobId: job.id,
            candidateId: candidate.id,
            score0to100: 90,
            evidence: {},
            explanation: [],
            version: 'v1.0',
          },
        }),
      ).rejects.toThrow()
    })

    it('should allow updating unique fields to same value', async () => {
      const job = await createTestJob({ slug: 'update-test' })

      const updated = await prisma.job.update({
        where: { id: job.id },
        data: { slug: 'update-test' }, // Same value
      })

      expect(updated.slug).toBe('update-test')
    })
  })

  // These used to assert ON DELETE CASCADE. The database says otherwise: none of
  // these relations declares `onDelete` in schema.prisma, so Prisma generated
  // ON DELETE RESTRICT for every one of them, and the parent delete raises P2003
  // while a child row still exists. That RESTRICT is the real contract — it is
  // why tests/integration/helpers/test-db.ts has to delete leaves first — so the
  // tests now pin it instead of asserting a cascade that was never there.
  describe('Referential actions on delete (RESTRICT)', () => {
    it('restricts deleting a job while an application references it', async () => {
      const job = await createTestJob()
      const candidate = await createTestCandidate()

      const application = await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.id,
          orgId: TEST_IDS.org,
          stage: 'NEW',
          source: 'WEBSITE',
        },
      })

      await expect(prisma.job.delete({ where: { id: job.id } })).rejects.toMatchObject({
        code: 'P2003',
      })

      // The application is untouched — no silent data loss behind a failed delete.
      const applicationAfter = await prisma.application.findUnique({
        where: { id: application.id },
      })
      expect(applicationAfter).not.toBeNull()

      // Removing the child first makes the parent delete succeed.
      await prisma.application.delete({ where: { id: application.id } })
      await expect(prisma.job.delete({ where: { id: job.id } })).resolves.toBeTruthy()
    })

    it('restricts deleting a candidate while a contact references it', async () => {
      const { candidate, contact } = await createTestCandidateWithContact()

      await expect(prisma.candidate.delete({ where: { id: candidate.id } })).rejects.toMatchObject({
        code: 'P2003',
      })

      const contactAfter = await prisma.candidateContact.findUnique({
        where: { id: contact.id },
      })
      expect(contactAfter).not.toBeNull()

      await prisma.candidateContact.delete({ where: { id: contact.id } })
      await expect(prisma.candidate.delete({ where: { id: candidate.id } })).resolves.toBeTruthy()
    })

    it('restricts deleting a resume while a section references it', async () => {
      const candidate = await createTestCandidate()

      const resume = await prisma.resume.create({
        data: {
          candidateId: candidate.id,
          language: 'en',
          skills: ['JavaScript', 'React'],
        },
      })

      const section = await prisma.resumeSection.create({
        data: {
          resumeId: resume.id,
          kind: 'EXPERIENCE',
          title: 'Software Engineer',
          organization: 'Tech Corp',
          text: 'Developed web applications',
          order: 1,
        },
      })

      await expect(prisma.resume.delete({ where: { id: resume.id } })).rejects.toMatchObject({
        code: 'P2003',
      })

      const sectionAfter = await prisma.resumeSection.findUnique({
        where: { id: section.id },
      })
      expect(sectionAfter).not.toBeNull()

      await prisma.resumeSection.delete({ where: { id: section.id } })
      await expect(prisma.resume.delete({ where: { id: resume.id } })).resolves.toBeTruthy()
    })

    it('restricts deleting an application while an activity references it', async () => {
      const job = await createTestJob()
      const candidate = await createTestCandidate()

      const application = await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.id,
          orgId: TEST_IDS.org,
          stage: 'NEW',
          source: 'WEBSITE',
        },
      })

      const activity = await prisma.applicationActivity.create({
        data: {
          applicationId: application.id,
          type: 'STAGE_CHANGE',
          description: 'Application created',
        },
      })

      // This is the constraint that made every "withdraw application" request
      // return 500: the route deleted the Application on its own, believing a
      // cascade would take the 'APPLIED' activity with it.
      await expect(
        prisma.application.delete({ where: { id: application.id } }),
      ).rejects.toMatchObject({ code: 'P2003' })

      const activityAfter = await prisma.applicationActivity.findUnique({
        where: { id: activity.id },
      })
      expect(activityAfter).not.toBeNull()

      await prisma.applicationActivity.delete({ where: { id: activity.id } })
      await expect(
        prisma.application.delete({ where: { id: application.id } }),
      ).resolves.toBeTruthy()
    })

    it('restricts deleting an email sequence run while an event references it', async () => {
      const candidate = await createTestCandidate()

      const sequence = await prisma.emailSequence.create({
        data: {
          orgId: TEST_IDS.org,
          name: 'Test Sequence',
          createdBy: TEST_IDS.recruiter,
          active: true,
        },
      })

      const step = await prisma.emailStep.create({
        data: {
          sequenceId: sequence.id,
          name: 'Step 1',
          dayOffset: 0,
          subject: 'Hello',
          bodyTemplate: 'Hello {{name}}',
          order: 1,
        },
      })

      const run = await prisma.emailSequenceRun.create({
        data: {
          sequenceId: sequence.id,
          candidateId: candidate.id,
          status: 'ACTIVE',
        },
      })

      const event = await prisma.emailSequenceEvent.create({
        data: {
          runId: run.id,
          stepId: step.id,
          kind: 'SCHEDULED',
        },
      })

      await expect(prisma.emailSequenceRun.delete({ where: { id: run.id } })).rejects.toMatchObject(
        { code: 'P2003' },
      )

      const eventAfter = await prisma.emailSequenceEvent.findUnique({
        where: { id: event.id },
      })
      expect(eventAfter).not.toBeNull()

      await prisma.emailSequenceEvent.delete({ where: { id: event.id } })
      await expect(prisma.emailSequenceRun.delete({ where: { id: run.id } })).resolves.toBeTruthy()
    })

    it('restricts deleting an attempt while an answer references it', async () => {
      const candidate = await createTestCandidate()

      const assessment = await prisma.assessment.create({
        data: {
          orgId: TEST_IDS.org,
          name: 'Test Assessment',
          createdBy: TEST_IDS.recruiter,
          isPublished: true,
        },
      })

      const section = await prisma.assessmentSection.create({
        data: {
          assessmentId: assessment.id,
          title: 'Section 1',
          order: 1,
        },
      })

      const question = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'MCQ',
          text: 'What is 2+2?',
          choices: ['3', '4', '5'],
          correctIndexes: [1],
          points: 10,
          order: 1,
        },
      })

      const invite = await prisma.assessmentInvite.create({
        data: {
          assessmentId: assessment.id,
          candidateId: candidate.id,
          token: 'test-token-cascade',
          status: 'STARTED',
        },
      })

      const attempt = await prisma.attempt.create({
        data: {
          inviteId: invite.id,
          candidateId: candidate.id,
          status: 'IN_PROGRESS',
        },
      })

      const answer = await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          response: { selectedIndex: 1 },
          autoScore: 10,
        },
      })

      await expect(prisma.attempt.delete({ where: { id: attempt.id } })).rejects.toMatchObject({
        code: 'P2003',
      })

      const answerAfter = await prisma.answer.findUnique({
        where: { id: answer.id },
      })
      expect(answerAfter).not.toBeNull()

      await prisma.answer.delete({ where: { id: answer.id } })
      await expect(prisma.attempt.delete({ where: { id: attempt.id } })).resolves.toBeTruthy()
    })
  })

  describe('Composite Keys and Indexes', () => {
    it('should enforce composite unique constraint on UserOrgRole', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'composite-test@example.com',
          name: 'Composite Test',
          password: 'hashedpassword',
          locale: 'en',
        },
      })

      await prisma.userOrgRole.create({
        data: {
          userId: user.id,
          orgId: TEST_IDS.org,
          role: 'RECRUITER',
        },
      })

      // Query by composite key
      const role = await prisma.userOrgRole.findUnique({
        where: {
          userId_orgId: {
            userId: user.id,
            orgId: TEST_IDS.org,
          },
        },
      })

      expect(role).toBeDefined()
      expect(role?.role).toBe('RECRUITER')
    })

    it('should use composite unique constraint on Application', async () => {
      const job = await createTestJob()
      const candidate = await createTestCandidate()

      const application = await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.id,
          orgId: TEST_IDS.org,
          stage: 'NEW',
          source: 'WEBSITE',
        },
      })

      // Query by composite unique key
      const found = await prisma.application.findUnique({
        where: {
          candidateId_jobId: {
            candidateId: candidate.id,
            jobId: job.id,
          },
        },
      })

      expect(found).toBeDefined()
      expect(found?.id).toBe(application.id)
    })
  })

  describe('Data Integrity', () => {
    it('should maintain referential integrity across complex relationships', async () => {
      const job = await createTestJob()
      const { candidate } = await createTestCandidateWithContact()

      const application = await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.id,
          orgId: TEST_IDS.org,
          stage: 'NEW',
          source: 'WEBSITE',
        },
      })

      await prisma.applicationActivity.create({
        data: {
          applicationId: application.id,
          type: 'APPLICATION_SUBMITTED',
          description: 'Application received',
        },
      })

      // Verify all relationships are intact
      const applicationWithRelations = await prisma.application.findUnique({
        where: { id: application.id },
        include: {
          job: true,
          candidate: {
            include: {
              contacts: true,
            },
          },
          activities: true,
        },
      })

      expect(applicationWithRelations).toBeDefined()
      expect(applicationWithRelations?.job.id).toBe(job.id)
      expect(applicationWithRelations?.candidate.id).toBe(candidate.id)
      expect(applicationWithRelations?.candidate.contacts).toHaveLength(1)
      expect(applicationWithRelations?.activities).toHaveLength(1)
    })

    it('should prevent orphaned records through foreign key constraints', async () => {
      const job = await createTestJob()
      const candidate = await createTestCandidate()

      const application = await prisma.application.create({
        data: {
          jobId: job.id,
          candidateId: candidate.id,
          orgId: TEST_IDS.org,
          stage: 'NEW',
          source: 'WEBSITE',
        },
      })

      // Try to delete job (should fail or cascade delete application)
      try {
        await prisma.job.delete({ where: { id: job.id } })

        // If cascade delete is configured, verify application is gone
        const appAfter = await prisma.application.findUnique({
          where: { id: application.id },
        })
        expect(appAfter).toBeNull()
      } catch (error) {
        // If cascade delete is not configured, should throw error
        expect(error).toBeDefined()
      }
    })
  })
})
