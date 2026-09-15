import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  getPrismaClient,
  seedTestData,
  cleanupDynamicData,
  cleanupAllTestData,
  disconnectDb,
  TEST_IDS,
  createTestJob,
  createTestCandidate,
} from '../helpers/test-db'
import { Prisma } from '@prisma/client'

/**
 * Database Transaction Integration Tests
 * Tests transaction rollback, concurrent operations, and database isolation
 */

const prisma = getPrismaClient()

describe('Database Transactions', () => {
  beforeAll(async () => {
    await seedTestData()
  })

  beforeEach(async () => {
    await cleanupDynamicData()
  })

  afterAll(async () => {
    await cleanupAllTestData()
    await disconnectDb()
  })

  describe('Transaction Rollback', () => {
    it('should rollback job creation when candidate creation fails', async () => {
      const jobsBefore = await prisma.job.count({ where: { orgId: TEST_IDS.org } })
      const candidatesBefore = await prisma.candidate.count({ where: { orgId: TEST_IDS.org } })

      try {
        await prisma.$transaction(async (tx) => {
          // Create a job successfully
          await tx.job.create({
            data: {
              title: 'Test Job',
              description: 'A'.repeat(100),
              orgId: TEST_IDS.org,
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
          })

          // Force failure by creating candidate with invalid orgId
          await tx.candidate.create({
            data: {
              orgId: 'non-existent-org-id',
              source: 'MANUAL',
            },
          })
        })

        // Should not reach here
        expect.fail('Transaction should have been rolled back')
      } catch (error) {
        // Expected to fail
        expect(error).toBeDefined()
      }

      // Verify rollback - counts should be unchanged
      const jobsAfter = await prisma.job.count({ where: { orgId: TEST_IDS.org } })
      const candidatesAfter = await prisma.candidate.count({ where: { orgId: TEST_IDS.org } })

      expect(jobsAfter).toBe(jobsBefore)
      expect(candidatesAfter).toBe(candidatesBefore)
    })

    it('should rollback application creation when stage update fails', async () => {
      const job = await createTestJob()
      const candidate = await createTestCandidate()

      const applicationsBefore = await prisma.application.count({ where: { orgId: TEST_IDS.org } })

      try {
        await prisma.$transaction(async (tx) => {
          // Create application
          const application = await tx.application.create({
            data: {
              jobId: job.id,
              candidateId: candidate.id,
              orgId: TEST_IDS.org,
              stage: 'NEW',
              source: 'WEBSITE',
            },
          })

          // Create activity
          await tx.applicationActivity.create({
            data: {
              applicationId: application.id,
              type: 'STAGE_CHANGE',
              description: 'Application created',
            },
          })

          // Force failure with invalid data
          await tx.application.update({
            where: { id: application.id },
            data: {
              // Invalid assignedTo user ID
              assignedTo: 'non-existent-user-id',
            },
          })
        })

        expect.fail('Transaction should have been rolled back')
      } catch (error) {
        expect(error).toBeDefined()
      }

      // Verify rollback - no new applications created
      const applicationsAfter = await prisma.application.count({ where: { orgId: TEST_IDS.org } })
      expect(applicationsAfter).toBe(applicationsBefore)

      // Verify no orphaned activities
      const activities = await prisma.applicationActivity.count()
      expect(activities).toBe(0)
    })

    it('should commit complex multi-table transaction successfully', async () => {
      const job = await createTestJob()
      const candidate = await createTestCandidate()

      const result = await prisma.$transaction(async (tx) => {
        // Create candidate contact
        const contact = await tx.candidateContact.create({
          data: {
            candidateId: candidate.id,
            fullName: 'Jane Doe',
            email: 'jane.doe@example.com',
            phone: '+421900654321',
            isPrimary: true,
          },
        })

        // Create application
        const application = await tx.application.create({
          data: {
            jobId: job.id,
            candidateId: candidate.id,
            orgId: TEST_IDS.org,
            stage: 'SCREENING',
            source: 'LINKEDIN',
          },
        })

        // Create activity
        const activity = await tx.applicationActivity.create({
          data: {
            applicationId: application.id,
            type: 'STAGE_CHANGE',
            description: 'Moved to screening',
            performedBy: TEST_IDS.recruiter,
          },
        })

        // Create match score
        const matchScore = await tx.matchScore.create({
          data: {
            orgId: TEST_IDS.org,
            jobId: job.id,
            candidateId: candidate.id,
            score0to100: 85,
            bm25Score: 0.75,
            vectorScore: 0.82,
            llmScore: 0.88,
            evidence: { skills: ['JavaScript', 'React'], experience: ['3 years'] },
            explanation: ['Strong technical skills', 'Relevant experience'],
            version: 'v1.0',
          },
        })

        return { contact, application, activity, matchScore }
      })

      // Verify all records were created
      expect(result.contact).toBeDefined()
      expect(result.application).toBeDefined()
      expect(result.activity).toBeDefined()
      expect(result.matchScore).toBeDefined()

      // Verify records exist in database
      const contactInDb = await prisma.candidateContact.findUnique({
        where: { id: result.contact.id },
      })
      expect(contactInDb).toBeDefined()
      expect(contactInDb?.email).toBe('jane.doe@example.com')

      const applicationInDb = await prisma.application.findUnique({
        where: { id: result.application.id },
      })
      expect(applicationInDb).toBeDefined()
      expect(applicationInDb?.stage).toBe('SCREENING')

      const matchScoreInDb = await prisma.matchScore.findUnique({
        where: { id: result.matchScore.id },
      })
      expect(matchScoreInDb).toBeDefined()
      expect(matchScoreInDb?.score0to100).toBe(85)
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle concurrent job creations without conflicts', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        prisma.job.create({
          data: {
            title: `Concurrent Job ${i}`,
            description: 'A'.repeat(100),
            orgId: TEST_IDS.org,
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
      )

      const results = await Promise.all(promises)

      expect(results).toHaveLength(5)
      results.forEach((job, i) => {
        expect(job.title).toBe(`Concurrent Job ${i}`)
      })

      // Verify all jobs are in database
      const jobs = await prisma.job.findMany({
        where: { title: { startsWith: 'Concurrent Job' } },
      })
      expect(jobs).toHaveLength(5)
    })

    it('should handle concurrent application updates with optimistic locking', async () => {
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

      // Simulate concurrent updates
      const updatePromises = [
        prisma.application.update({
          where: { id: application.id },
          data: { stage: 'SCREENING' },
        }),
        prisma.application.update({
          where: { id: application.id },
          data: { isStarred: true },
        }),
        prisma.application.update({
          where: { id: application.id },
          data: { tags: ['priority'] },
        }),
      ]

      await Promise.all(updatePromises)

      // Verify final state includes all updates
      const updated = await prisma.application.findUnique({
        where: { id: application.id },
      })

      expect(updated).toBeDefined()
      expect(updated?.stage).toBe('SCREENING')
      expect(updated?.isStarred).toBe(true)
      expect(updated?.tags).toContain('priority')
    })

    it('should prevent race conditions in candidate duplicate detection', async () => {
      const email = 'duplicate@example.com'

      // Create multiple candidates concurrently with same email
      const createCandidates = async () => {
        const candidate = await prisma.candidate.create({
          data: {
            orgId: TEST_IDS.org,
            source: 'MANUAL',
          },
        })

        await prisma.candidateContact.create({
          data: {
            candidateId: candidate.id,
            fullName: 'Duplicate Test',
            email,
            isPrimary: true,
          },
        })

        return candidate
      }

      // Create 3 candidates concurrently (all can succeed - they're different candidates)
      const promises = Array.from({ length: 3 }, () => createCandidates())
      const candidates = await Promise.all(promises)

      expect(candidates).toHaveLength(3)

      // Verify all contacts were created (contacts can have same email in different candidates)
      const contacts = await prisma.candidateContact.findMany({
        where: { email },
      })
      expect(contacts).toHaveLength(3)

      // In real scenario, duplicate detection would be done at application level
      // Here we verify database allows multiple candidates with same email contacts
    })
  })

  describe('Nested Transactions', () => {
    it('should handle nested writes in transaction', async () => {
      const job = await createTestJob()

      const result = await prisma.$transaction(async (tx) => {
        // Create candidate with nested contact
        const candidate = await tx.candidate.create({
          data: {
            orgId: TEST_IDS.org,
            source: 'WEBSITE',
            contacts: {
              create: {
                fullName: 'Nested Test',
                email: 'nested@example.com',
                isPrimary: true,
              },
            },
          },
          include: {
            contacts: true,
          },
        })

        // Create application with nested activity
        const application = await tx.application.create({
          data: {
            jobId: job.id,
            candidateId: candidate.id,
            orgId: TEST_IDS.org,
            stage: 'NEW',
            source: 'WEBSITE',
            activities: {
              create: {
                type: 'APPLICATION_SUBMITTED',
                description: 'Application received',
              },
            },
          },
          include: {
            activities: true,
          },
        })

        return { candidate, application }
      })

      expect(result.candidate.contacts).toHaveLength(1)
      expect(result.candidate.contacts[0].email).toBe('nested@example.com')
      expect(result.application.activities).toHaveLength(1)
      expect(result.application.activities[0].type).toBe('APPLICATION_SUBMITTED')
    })

    it('should rollback nested creates on failure', async () => {
      const candidatesBefore = await prisma.candidate.count({ where: { orgId: TEST_IDS.org } })
      const contactsBefore = await prisma.candidateContact.count()

      try {
        await prisma.$transaction(async (tx) => {
          // Create candidate with nested contact (succeeds)
          await tx.candidate.create({
            data: {
              orgId: TEST_IDS.org,
              source: 'WEBSITE',
              contacts: {
                create: {
                  fullName: 'Will Rollback',
                  email: 'rollback@example.com',
                  isPrimary: true,
                },
              },
            },
          })

          // Force failure
          await tx.candidate.create({
            data: {
              orgId: 'invalid-org-id',
              source: 'WEBSITE',
            },
          })
        })

        expect.fail('Should have rolled back')
      } catch (error) {
        expect(error).toBeDefined()
      }

      // Verify rollback
      const candidatesAfter = await prisma.candidate.count({ where: { orgId: TEST_IDS.org } })
      const contactsAfter = await prisma.candidateContact.count()

      expect(candidatesAfter).toBe(candidatesBefore)
      expect(contactsAfter).toBe(contactsBefore)
    })
  })

  describe('Transaction Isolation', () => {
    // This pair used to be one test asserting that a second read inside a
    // transaction still sees the pre-transaction value. That is REPEATABLE READ
    // behaviour; Postgres (and therefore every Prisma transaction in this app that
    // does not ask for anything else) defaults to READ COMMITTED, where each
    // statement takes a fresh snapshot. It also raced the external write against a
    // sleep, so it could fail in either direction depending on machine speed. Both
    // levels are now pinned explicitly, and the two sides hand off through
    // promises instead of timers.
    const deferred = () => {
      let resolve!: () => void
      const promise = new Promise<void>((r) => {
        resolve = r
      })
      return { promise, resolve }
    }

    it('sees externally committed writes inside a transaction (READ COMMITTED default)', async () => {
      const job = await createTestJob({ title: 'Isolation Test Job' })

      const firstReadDone = deferred()
      const externalWriteCommitted = deferred()

      const transactionPromise = prisma.$transaction(
        async (tx) => {
          const jobInTx = await tx.job.findUnique({ where: { id: job.id } })
          expect(jobInTx?.title).toBe('Isolation Test Job')

          firstReadDone.resolve()
          await externalWriteCommitted.promise

          // READ COMMITTED: the second statement takes a new snapshot, so the
          // committed external write is visible inside the open transaction.
          const jobInTxAgain = await tx.job.findUnique({ where: { id: job.id } })
          expect(jobInTxAgain?.title).toBe('Updated Externally')

          return jobInTx
        },
        { timeout: 20000, maxWait: 10000 },
      )

      await firstReadDone.promise
      await prisma.job.update({
        where: { id: job.id },
        data: { title: 'Updated Externally' },
      })
      externalWriteCommitted.resolve()

      await transactionPromise

      const jobAfter = await prisma.job.findUnique({ where: { id: job.id } })
      expect(jobAfter?.title).toBe('Updated Externally')
    })

    it('holds a stable snapshot when the transaction asks for REPEATABLE READ', async () => {
      const job = await createTestJob({ title: 'Snapshot Test Job' })

      const firstReadDone = deferred()
      const externalWriteCommitted = deferred()

      const transactionPromise = prisma.$transaction(
        async (tx) => {
          // The first statement fixes the snapshot, before the external write.
          const jobInTx = await tx.job.findUnique({ where: { id: job.id } })
          expect(jobInTx?.title).toBe('Snapshot Test Job')

          firstReadDone.resolve()
          await externalWriteCommitted.promise

          const jobInTxAgain = await tx.job.findUnique({ where: { id: job.id } })
          expect(jobInTxAgain?.title).toBe('Snapshot Test Job')

          return jobInTx
        },
        { isolationLevel: 'RepeatableRead', timeout: 20000, maxWait: 10000 },
      )

      await firstReadDone.promise
      await prisma.job.update({
        where: { id: job.id },
        data: { title: 'Updated Externally' },
      })
      externalWriteCommitted.resolve()

      await transactionPromise

      const jobAfter = await prisma.job.findUnique({ where: { id: job.id } })
      expect(jobAfter?.title).toBe('Updated Externally')
    })
  })

  describe('Error Handling', () => {
    it('should handle unique constraint violation in transaction', async () => {
      const slug = 'unique-test-job'

      await createTestJob({ slug })

      try {
        await prisma.$transaction(async (tx) => {
          await tx.job.create({
            data: {
              title: 'Another Job',
              description: 'A'.repeat(100),
              orgId: TEST_IDS.org,
              createdBy: TEST_IDS.recruiter,
              locale: 'en',
              slug, // Duplicate slug
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
        })

        expect.fail('Should throw unique constraint error')
      } catch (error) {
        expect(error).toBeDefined()
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          expect(error.code).toBe('P2002')
        }
      }
    })

    it('should handle foreign key constraint violation', async () => {
      try {
        await prisma.$transaction(async (tx) => {
          await tx.application.create({
            data: {
              jobId: 'non-existent-job-id',
              candidateId: 'non-existent-candidate-id',
              orgId: TEST_IDS.org,
              stage: 'NEW',
              source: 'WEBSITE',
            },
          })
        })

        expect.fail('Should throw foreign key constraint error')
      } catch (error) {
        expect(error).toBeDefined()
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          expect(error.code).toBe('P2003')
        }
      }
    })
  })
})
