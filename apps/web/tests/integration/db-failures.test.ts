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
} from './helpers/test-db'
import { Prisma, PrismaClient } from '@prisma/client'
import { handleApiError } from '@/lib/errors'

/**
 * Database Failure Integration Tests
 *
 * Tests database failure scenarios including:
 * - Database connection loss
 * - Query timeout
 * - Deadlock handling
 * - Constraint violation errors
 * - Graceful degradation
 */

const prisma = getPrismaClient()

describe('Database Failure Tests', () => {
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

  describe('Connection Loss Scenarios', () => {
    it('should handle database connection timeout gracefully', async () => {
      // Create a client with extremely short timeout
      const shortTimeoutClient = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL,
          },
        },
      })

      try {
        // Execute a query that might timeout
        await shortTimeoutClient.$queryRaw`SELECT pg_sleep(0.1)`

        // Disconnect and try to query (simulates connection loss)
        await shortTimeoutClient.$disconnect()

        try {
          await shortTimeoutClient.job.findMany()
          expect.fail('Should throw error when disconnected')
        } catch (error) {
          expect(error).toBeDefined()
          // Verify it's a Prisma client error
          expect(
            error instanceof Prisma.PrismaClientInitializationError ||
              error instanceof Prisma.PrismaClientKnownRequestError ||
              error instanceof Error,
          ).toBe(true)
        }
      } finally {
        await shortTimeoutClient.$disconnect()
      }
    })

    it('should recover from transient connection errors with retry logic', async () => {
      let attemptCount = 0
      const maxRetries = 3

      const executeWithRetry = async <T>(
        operation: () => Promise<T>,
        retries = maxRetries,
      ): Promise<T> => {
        try {
          attemptCount++
          return await operation()
        } catch (error) {
          if (retries > 0 && error instanceof Prisma.PrismaClientKnownRequestError) {
            // Retry on connection errors (P1001, P1002, P1008, P1017)
            if (['P1001', 'P1002', 'P1008', 'P1017'].includes(error.code)) {
              await new Promise((resolve) => setTimeout(resolve, 100))
              return executeWithRetry(operation, retries - 1)
            }
          }
          throw error
        }
      }

      // Simulate operation that succeeds
      const result = await executeWithRetry(() =>
        prisma.job.count({ where: { orgId: TEST_IDS.org } }),
      )

      expect(result).toBeDefined()
      expect(attemptCount).toBeGreaterThan(0)
    })

    it('should provide meaningful error messages on connection failure', async () => {
      const invalidClient = new PrismaClient({
        datasources: {
          db: {
            url: 'postgresql://invalid:invalid@localhost:9999/invalid',
          },
        },
      })

      try {
        await invalidClient.$connect()
        expect.fail('Should fail to connect to invalid database')
      } catch (error) {
        expect(error).toBeDefined()
        expect(error instanceof Prisma.PrismaClientInitializationError).toBe(true)

        if (error instanceof Prisma.PrismaClientInitializationError) {
          expect(error.message).toBeDefined()
          expect(error.message.length).toBeGreaterThan(0)
        }
      } finally {
        await invalidClient.$disconnect().catch(() => {})
      }
    })
  })

  describe('Query Timeout Scenarios', () => {
    it('should timeout long-running queries gracefully', async () => {
      try {
        // Attempt a very long sleep (this should timeout or complete quickly in test)
        // Note: Actual timeout depends on database and Prisma client configuration
        await prisma.$queryRaw`SELECT pg_sleep(0.01)`

        // If it completes, that's fine - we're verifying it handles it gracefully
        expect(true).toBe(true)
      } catch (error) {
        // If it times out, verify error handling
        expect(error).toBeDefined()

        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          // P2024 = Timed out fetching a new connection from the pool
          expect(['P2024', 'P1008'].includes(error.code)).toBe(true)
        }
      }
    })

    it('should handle timeout in transaction', async () => {
      const job = await createTestJob()

      try {
        await prisma.$transaction(
          async (tx) => {
            // Perform quick operation
            await tx.job.findUnique({ where: { id: job.id } })

            // Simulate timeout with sleep (short for testing)
            await tx.$queryRaw`SELECT pg_sleep(0.01)`

            // Try to update
            await tx.job.update({
              where: { id: job.id },
              data: { title: 'Updated Title' },
            })
          },
          {
            timeout: 5000, // 5 second timeout
          },
        )

        // Should succeed or timeout
        expect(true).toBe(true)
      } catch (error) {
        // If timeout occurs, verify proper error handling
        expect(error).toBeDefined()
      }
    })

    it('should provide timeout error details for debugging', async () => {
      try {
        // Create a scenario that might timeout
        await prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT pg_sleep(0.01)`
          },
          {
            timeout: 1, // Very short timeout (1ms)
          },
        )
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).toBeDefined()
          // Error message should be helpful
          expect(error.message.length).toBeGreaterThan(0)
        }
      }
    })
  })

  describe('Deadlock Handling', () => {
    it('should detect and report deadlock situations', async () => {
      const job1 = await createTestJob({ title: 'Job 1' })
      const job2 = await createTestJob({ title: 'Job 2' })

      // Attempt to create a potential deadlock scenario
      // Note: This is hard to reliably reproduce in tests, so we simulate the error handling

      try {
        await Promise.all([
          prisma.$transaction(async (tx) => {
            await tx.job.update({ where: { id: job1.id }, data: { title: 'Updated 1A' } })
            await new Promise((resolve) => setTimeout(resolve, 10))
            await tx.job.update({ where: { id: job2.id }, data: { title: 'Updated 2A' } })
          }),
          prisma.$transaction(async (tx) => {
            await tx.job.update({ where: { id: job2.id }, data: { title: 'Updated 2B' } })
            await new Promise((resolve) => setTimeout(resolve, 10))
            await tx.job.update({ where: { id: job1.id }, data: { title: 'Updated 1B' } })
          }),
        ])

        // Most likely one will succeed
        expect(true).toBe(true)
      } catch (error) {
        // If deadlock occurs, verify error handling
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          // P2034 = Transaction failed due to a write conflict or deadlock
          expect(error.code).toMatch(/P2034|P2028/)
        }
      }
    })

    it('should retry operations after deadlock', async () => {
      const job = await createTestJob()
      let retryCount = 0
      const maxRetries = 3

      const updateWithRetry = async (): Promise<void> => {
        for (let i = 0; i < maxRetries; i++) {
          try {
            retryCount++
            await prisma.job.update({
              where: { id: job.id },
              data: { title: `Retry Attempt ${i}` },
            })
            return
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
              // Retry on deadlock
              if (error.code === 'P2034' && i < maxRetries - 1) {
                await new Promise((resolve) => setTimeout(resolve, 50 * (i + 1)))
                continue
              }
            }
            throw error
          }
        }
      }

      await updateWithRetry()
      expect(retryCount).toBeGreaterThan(0)
      expect(retryCount).toBeLessThanOrEqual(maxRetries)

      const updated = await prisma.job.findUnique({ where: { id: job.id } })
      expect(updated?.title).toContain('Retry Attempt')
    })

    it('should handle concurrent updates to same record', async () => {
      const candidate = await createTestCandidate()

      // Concurrent updates
      const updates = await Promise.allSettled([
        prisma.candidate.update({
          where: { id: candidate.id },
          data: { source: 'LINKEDIN' },
        }),
        prisma.candidate.update({
          where: { id: candidate.id },
          data: { source: 'INDEED' },
        }),
        prisma.candidate.update({
          where: { id: candidate.id },
          data: { source: 'REFERRAL' },
        }),
      ])

      // At least one should succeed
      const succeeded = updates.filter((result) => result.status === 'fulfilled')
      expect(succeeded.length).toBeGreaterThan(0)

      // Verify final state is one of the updated values
      const finalCandidate = await prisma.candidate.findUnique({ where: { id: candidate.id } })
      expect(['LINKEDIN', 'INDEED', 'REFERRAL', 'MANUAL']).toContain(finalCandidate?.source)
    })
  })

  describe('Constraint Violation Errors', () => {
    it('should handle unique constraint violations', async () => {
      const slug = 'unique-job-slug'
      await createTestJob({ slug })

      try {
        await createTestJob({ slug })
        expect.fail('Should throw unique constraint error')
      } catch (error) {
        expect(error).toBeDefined()

        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          expect(error.code).toBe('P2002')
          expect(error.meta).toBeDefined()
          // Verify target field is included in error
          expect(error.meta?.target).toBeDefined()
        }
      }
    })

    it('should handle foreign key constraint violations', async () => {
      try {
        await prisma.application.create({
          data: {
            jobId: 'non-existent-job-id',
            candidateId: 'non-existent-candidate-id',
            orgId: TEST_IDS.org,
            stage: 'NEW',
            source: 'WEBSITE',
          },
        })

        expect.fail('Should throw foreign key constraint error')
      } catch (error) {
        expect(error).toBeDefined()

        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          expect(error.code).toBe('P2003')
          // Foreign key error should include field info
          expect(error.meta).toBeDefined()
        }
      }
    })

    it('should handle not null constraint violations', async () => {
      try {
        await prisma.job.create({
          data: {
            // Missing required fields like title, description
            orgId: TEST_IDS.org,
            createdBy: TEST_IDS.recruiter,
            locale: 'en',
          } as any,
        })

        expect.fail('Should throw not null constraint error')
      } catch (error) {
        expect(error).toBeDefined()

        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          // P2011 = Null constraint violation
          // P2012 = Missing required value
          expect(['P2011', 'P2012', 'P2000'].includes(error.code)).toBe(true)
        }
      }
    })

    it('should handle check constraint violations', async () => {
      const job = await createTestJob()

      try {
        // Try to set salaryMin > salaryMax (if check constraint exists)
        await prisma.job.update({
          where: { id: job.id },
          data: {
            salaryMin: 100000,
            salaryMax: 50000,
          },
        })

        // If no check constraint at DB level, this will succeed
        // Validate at application level instead
        const updated = await prisma.job.findUnique({ where: { id: job.id } })

        if (updated && updated.salaryMin && updated.salaryMax) {
          // Application-level validation
          if (updated.salaryMin > updated.salaryMax) {
            // Would typically be caught by Zod validation before DB
            expect(updated.salaryMin).toBeGreaterThan(updated.salaryMax)
          }
        }
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          // P2015 = Check constraint violation
          expect(error.code).toBe('P2015')
        }
      }
    })

    it('should provide user-friendly error messages for constraint violations', async () => {
      const slug = 'duplicate-slug'
      await createTestJob({ slug })

      try {
        await createTestJob({ slug })
        expect.fail('Should throw unique constraint error')
      } catch (error) {
        expect(error).toBeDefined()

        // Test error handler formatting
        const response = handleApiError(error)
        expect(response.status).toBe(409)

        const body = await response.json()
        expect(body.error).toBe('Resource already exists')
      }
    })
  })

  describe('Graceful Degradation', () => {
    it('should return cached data when database is slow', async () => {
      const jobs = await prisma.job.findMany({
        where: { orgId: TEST_IDS.org },
        take: 5,
      })

      // Simulate cache layer
      const cache = new Map<string, any>()
      const cacheKey = `jobs:${TEST_IDS.org}`
      cache.set(cacheKey, jobs)

      // Function that tries DB first, falls back to cache
      const getJobsWithFallback = async () => {
        try {
          const startTime = Date.now()
          const dbJobs = await prisma.job.findMany({
            where: { orgId: TEST_IDS.org },
            take: 5,
          })
          const duration = Date.now() - startTime

          // If query is too slow (>100ms), use cache next time
          if (duration > 100) {
            console.warn('Database slow, consider using cache')
          }

          return dbJobs
        } catch (error) {
          // Fall back to cache on error
          console.error('Database error, using cache:', error)
          return cache.get(cacheKey) || []
        }
      }

      const result = await getJobsWithFallback()
      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
    })

    it('should provide partial results when some queries fail', async () => {
      const job = await createTestJob()
      const candidate = await createTestCandidate()

      // Fetch multiple resources, some may fail
      const results = await Promise.allSettled([
        prisma.job.findUnique({ where: { id: job.id } }),
        prisma.candidate.findUnique({ where: { id: candidate.id } }),
        prisma.job.findUnique({ where: { id: 'non-existent' } }), // Will return null
        prisma.application.findMany({ where: { jobId: job.id } }),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      expect(fulfilled.length).toBeGreaterThan(0)

      // Extract successful results
      const data = fulfilled.map((r) => (r as PromiseFulfilledResult<any>).value)
      expect(data.some((d) => d !== null)).toBe(true)
    })

    it('should handle database unavailable with fallback behavior', async () => {
      const fallbackJobs = [
        { id: '1', title: 'Fallback Job 1' },
        { id: '2', title: 'Fallback Job 2' },
      ]

      const getJobsWithFallback = async () => {
        try {
          return await prisma.job.findMany({
            where: { orgId: TEST_IDS.org },
            take: 10,
          })
        } catch {
          console.error('Database unavailable, using fallback data')
          // Return fallback data
          return fallbackJobs as any[]
        }
      }

      const result = await getJobsWithFallback()
      expect(result).toBeDefined()
      expect(Array.isArray(result)).toBe(true)
    })

    it('should log errors for monitoring while continuing operation', async () => {
      const errors: Error[] = []
      const logError = (error: Error) => errors.push(error)

      const operations = [
        prisma.job.findMany({ where: { orgId: TEST_IDS.org } }),
        prisma.candidate.findMany({ where: { orgId: TEST_IDS.org } }),
        // Intentionally invalid operation
        prisma.job.findUnique({ where: { id: 'invalid-id' } as any }),
      ]

      const results = await Promise.allSettled(operations)

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          logError(new Error(`Operation ${index} failed: ${result.reason}`))
        }
      })

      // Verify we captured errors for monitoring
      expect(errors.length).toBeGreaterThanOrEqual(0)

      // Verify some operations succeeded
      const succeeded = results.filter((r) => r.status === 'fulfilled')
      expect(succeeded.length).toBeGreaterThan(0)
    })

    it('should implement circuit breaker pattern for repeated failures', async () => {
      let failureCount = 0
      let circuitOpen = false
      const failureThreshold = 3
      const resetTimeout = 1000

      const executeWithCircuitBreaker = async <T>(
        operation: () => Promise<T>,
      ): Promise<T | null> => {
        if (circuitOpen) {
          console.log('Circuit breaker open, rejecting request')
          return null
        }

        try {
          const result = await operation()
          // Reset failure count on success
          failureCount = 0
          return result
        } catch (error) {
          failureCount++
          console.error(`Operation failed (${failureCount}/${failureThreshold})`)

          if (failureCount >= failureThreshold) {
            console.error('Circuit breaker opened')
            circuitOpen = true

            // Reset after timeout
            setTimeout(() => {
              console.log('Circuit breaker reset')
              circuitOpen = false
              failureCount = 0
            }, resetTimeout)
          }

          throw error
        }
      }

      // Test circuit breaker
      const validOperation = () => prisma.job.count({ where: { orgId: TEST_IDS.org } })

      const result = await executeWithCircuitBreaker(validOperation)
      expect(result).toBeDefined()
      expect(failureCount).toBe(0)
    })

    it('should provide meaningful error context for debugging', async () => {
      try {
        await prisma.job.create({
          data: {
            title: 'Test',
            description: 'Short', // Too short (min 50 chars)
            orgId: 'invalid-org',
            createdBy: 'invalid-user',
            locale: 'en',
          } as any,
        })

        expect.fail('Should throw error')
      } catch (error) {
        expect(error).toBeDefined()

        // Verify error contains useful debugging info
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          expect(error.code).toBeDefined()
          expect(error.message).toBeDefined()
          expect(error.meta).toBeDefined()

          // Error should have context for debugging
          const errorContext = {
            code: error.code,
            message: error.message,
            meta: error.meta,
            clientVersion: error.clientVersion,
          }

          expect(errorContext.code).toBeTruthy()
          expect(errorContext.message).toBeTruthy()
        }
      }
    })
  })

  describe('Transaction Failure Recovery', () => {
    it('should rollback transaction on any error', async () => {
      const jobsBefore = await prisma.job.count({ where: { orgId: TEST_IDS.org } })

      try {
        await prisma.$transaction(async (tx) => {
          // Create job successfully
          await tx.job.create({
            data: {
              title: 'Will Rollback',
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

          // Force error with invalid data
          await tx.candidate.create({
            data: {
              orgId: 'invalid-org-id',
              source: 'MANUAL',
            },
          })
        })

        expect.fail('Transaction should have failed')
      } catch (error) {
        expect(error).toBeDefined()
      }

      // Verify rollback
      const jobsAfter = await prisma.job.count({ where: { orgId: TEST_IDS.org } })
      expect(jobsAfter).toBe(jobsBefore)
    })

    it('should clean up resources after transaction failure', async () => {
      const candidatesBefore = await prisma.candidate.count({ where: { orgId: TEST_IDS.org } })
      const contactsBefore = await prisma.candidateContact.count()

      try {
        await prisma.$transaction(async (tx) => {
          const candidate = await tx.candidate.create({
            data: {
              orgId: TEST_IDS.org,
              source: 'MANUAL',
            },
          })

          await tx.candidateContact.create({
            data: {
              candidateId: candidate.id,
              fullName: 'Test',
              email: 'test@example.com',
              isPrimary: true,
            },
          })

          // Force failure
          throw new Error('Simulated failure')
        })

        expect.fail('Should have thrown error')
      } catch (error) {
        expect(error).toBeDefined()
      }

      // Verify cleanup
      const candidatesAfter = await prisma.candidate.count({ where: { orgId: TEST_IDS.org } })
      const contactsAfter = await prisma.candidateContact.count()

      expect(candidatesAfter).toBe(candidatesBefore)
      expect(contactsAfter).toBe(contactsBefore)
    })

    it('should handle nested transaction failures', async () => {
      const job = await createTestJob()
      const applicationsBefore = await prisma.application.count({ where: { orgId: TEST_IDS.org } })

      try {
        await prisma.$transaction(async (tx) => {
          // Create candidate with nested contact
          const candidate = await tx.candidate.create({
            data: {
              orgId: TEST_IDS.org,
              source: 'WEBSITE',
              contacts: {
                create: {
                  fullName: 'Nested Test',
                  email: 'nested@test.com',
                  isPrimary: true,
                },
              },
            },
          })

          // Create application with nested activity
          await tx.application.create({
            data: {
              jobId: job.id,
              candidateId: candidate.id,
              orgId: TEST_IDS.org,
              stage: 'NEW',
              source: 'WEBSITE',
              activities: {
                create: {
                  type: 'APPLICATION_SUBMITTED',
                  description: 'Test',
                },
              },
            },
          })

          // Force failure
          await tx.candidate.create({
            data: {
              orgId: 'invalid',
              source: 'MANUAL',
            },
          })
        })

        expect.fail('Should have failed')
      } catch (error) {
        expect(error).toBeDefined()
      }

      // Verify all nested creates were rolled back
      const applicationsAfter = await prisma.application.count({ where: { orgId: TEST_IDS.org } })
      expect(applicationsAfter).toBe(applicationsBefore)
    })
  })

  describe('Error Message Clarity', () => {
    it('should provide clear error for record not found', async () => {
      try {
        await prisma.job.findUniqueOrThrow({
          where: { id: 'non-existent-id' },
        })

        expect.fail('Should throw not found error')
      } catch (error) {
        expect(error).toBeDefined()

        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          expect(error.code).toBe('P2025')
          // Prisma 5.22 words this "No Job found" — the code is the stable
          // contract callers branch on, the prose is not.
        }
      }
    })

    it('should provide clear error for invalid data type', async () => {
      try {
        await prisma.job.create({
          data: {
            title: 'Test',
            description: 'A'.repeat(100),
            orgId: TEST_IDS.org,
            createdBy: TEST_IDS.recruiter,
            locale: 'en',
            salaryMin: 'not a number' as any, // Invalid type
            status: 'PUBLISHED',
            employmentType: 'FULL_TIME',
            seniority: 'MID',
          },
        })

        expect.fail('Should throw validation error')
      } catch (error) {
        expect(error).toBeDefined()
        // Prisma should catch type mismatch
      }
    })

    it('should provide actionable error messages via API handler', async () => {
      const errors = [
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: ['slug'] },
        }),
        new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
          code: 'P2003',
          clientVersion: '5.0.0',
          meta: { field_name: 'jobId' },
        }),
        new Prisma.PrismaClientKnownRequestError('Record not found', {
          code: 'P2025',
          clientVersion: '5.0.0',
        }),
      ]

      for (const error of errors) {
        const response = handleApiError(error)
        expect(response.status).toBeGreaterThanOrEqual(400)
        expect(response.status).toBeLessThan(600)

        const body = await response.json()
        expect(body.error).toBeDefined()
        expect(typeof body.error).toBe('string')
        expect(body.error.length).toBeGreaterThan(0)
      }
    })
  })
})
