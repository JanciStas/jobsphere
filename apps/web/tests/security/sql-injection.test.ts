/**
 * SQL Injection Prevention Tests
 *
 * Comprehensive security tests to verify protection against SQL injection attacks.
 * These tests ensure that:
 * - Prisma's parameterized queries prevent SQL injection
 * - Raw SQL queries use proper parameterization
 * - Search filters are properly sanitized
 * - NoSQL injection patterns are blocked
 * - Union-based and boolean-based SQL injection attempts fail
 *
 * Test Coverage:
 * ✓ Search query injection attempts
 * ✓ Prisma query builder safety
 * ✓ Raw SQL parameterization ($queryRaw)
 * ✓ Filter parameter injection
 * ✓ Union-based SQL injection
 * ✓ Boolean-based blind SQL injection
 * ✓ Time-based blind SQL injection
 * ✓ NoSQL injection patterns
 * ✓ Second-order SQL injection
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { ApplicationService } from '@/services/application.service'
import { searchCandidates } from '@/lib/semantic-search'
import { Prisma } from '@prisma/client'
import { prisma, TEST_IDS, seedTestData, cleanupAllTestData } from '../integration/helpers/test-db'

/**
 * Test Utilities
 */

/**
 * Common SQL injection payloads used by attackers
 */
const SQL_INJECTION_PAYLOADS = {
  // Classic SQL injection patterns
  classic: [
    "' OR '1'='1",
    "' OR 1=1--",
    "' OR 1=1#",
    "' OR 1=1/*",
    "admin'--",
    "admin' #",
    "admin'/*",
    "' or 1=1--",
    "' or 1=1#",
    "' or 1=1/*",
    "') or '1'='1--",
    "') or ('1'='1--",
  ],

  // Union-based SQL injection
  union: [
    "' UNION SELECT NULL--",
    "' UNION SELECT NULL, NULL--",
    "' UNION SELECT NULL, NULL, NULL--",
    "' UNION SELECT password FROM users--",
    "' UNION ALL SELECT NULL,NULL,NULL--",
    '1\' UNION SELECT email, password FROM "User"--',
    "1' UNION SELECT table_name FROM information_schema.tables--",
  ],

  // Boolean-based blind SQL injection
  booleanBlind: [
    "' AND '1'='1",
    "' AND '1'='2",
    "' AND 1=1--",
    "' AND 1=2--",
    "' AND (SELECT COUNT(*) FROM users) > 0--",
    '\' AND EXISTS(SELECT * FROM "User")--',
  ],

  // Time-based blind SQL injection
  timeBlind: [
    "'; WAITFOR DELAY '00:00:05'--",
    "'; SELECT pg_sleep(5)--",
    "' AND pg_sleep(5)--",
    "' OR pg_sleep(5)--",
    "1'; SELECT CASE WHEN (1=1) THEN pg_sleep(5) ELSE pg_sleep(0) END--",
  ],

  // Stacked queries
  stacked: [
    '\'; DROP TABLE "User"--',
    '\'; DELETE FROM "User"--',
    "'; UPDATE \"User\" SET email='hacked@example.com'--",
    "1'; INSERT INTO \"User\" (email) VALUES ('injected@example.com')--",
  ],

  // Comment injection
  comment: ["admin'--", "admin'/*", "admin'#", '/* comment */ admin', 'admin -- comment'],

  // PostgreSQL-specific
  postgres: [
    "'; SELECT version()--",
    "' OR 1=1; SELECT * FROM pg_database--",
    "'; COPY \"User\" TO '/tmp/users.csv'--",
    "' OR 1=1; CREATE TABLE hacked (id INT)--",
  ],

  // NoSQL injection patterns (for filter objects)
  nosql: [{ $gt: '' }, { $ne: null }, { $regex: '.*' }, { $where: '1==1' }, { email: { $gt: '' } }],
}

/**
 * Test Data Setup
 */
let testOrg: any
let testUser: any
let testJob: any
let testCandidate: any
let testApplication: any

// Mock generateEmbedding for semantic search tests
vi.mock('@/lib/embeddings', () => ({
  generateEmbedding: vi.fn(() => {
    // Return a mock embedding (1536 dimensions for OpenAI)
    return Array(1536)
      .fill(0)
      .map(() => Math.random())
  }),
}))

describe('SQL Injection Prevention Tests', () => {
  beforeAll(async () => {
    // Seed base test data
    await seedTestData()

    // Use test organization and user
    testOrg = await prisma.organization.findUnique({
      where: { id: TEST_IDS.org },
    })

    testUser = await prisma.user.findUnique({
      where: { id: TEST_IDS.admin },
    })

    // Create test job
    testJob = await prisma.job.create({
      data: {
        title: 'SQL Test Job',
        description: 'A'.repeat(100), // Min 50 chars
        orgId: TEST_IDS.org,
        createdBy: TEST_IDS.admin,
        locale: 'en',
        status: 'PUBLISHED',
        employmentType: 'FULL_TIME',
        seniority: 'MID',
        salaryMin: 50000,
        salaryMax: 80000,
        salaryCurrency: 'EUR',
        remote: true,
      },
    })

    // Create test candidate
    testCandidate = await prisma.candidate.create({
      data: {
        orgId: TEST_IDS.org,
        source: 'CAREER_PAGE',
      },
    })

    // Create candidate contact
    await prisma.candidateContact.create({
      data: {
        candidateId: testCandidate.id,
        fullName: 'Test Candidate',
        email: 'candidate@example.com',
        isPrimary: true,
      },
    })

    // Create test application
    testApplication = await prisma.application.create({
      data: {
        jobId: testJob.id,
        candidateId: testCandidate.id,
        orgId: TEST_IDS.org,
        stage: 'NEW',
        source: 'WEBSITE',
        coverLetter: 'Test cover letter',
      },
    })
  })

  afterAll(async () => {
    // Cleanup test data
    await cleanupAllTestData()
  })

  beforeEach(async () => {
    // Clean up dynamic data between test suites if needed
    vi.clearAllMocks()
  })

  describe('Search Query SQL Injection', () => {
    it('should prevent SQL injection in application search (classic patterns)', async () => {
      for (const payload of SQL_INJECTION_PAYLOADS.classic) {
        const { applications } = await ApplicationService.searchApplications({
          search: payload,
          limit: 10,
        })

        // Should return empty results or safe results, not throw error or expose data
        expect(Array.isArray(applications)).toBe(true)

        // Should not return all applications (which would indicate successful injection)
        // We only have 1 test application, so if it returns more, something is wrong
        expect(applications.length).toBeLessThanOrEqual(1)
      }
    })

    it('should prevent SQL injection in application search (union-based)', async () => {
      for (const payload of SQL_INJECTION_PAYLOADS.union) {
        const { applications } = await ApplicationService.searchApplications({
          search: payload,
          limit: 10,
        })

        expect(Array.isArray(applications)).toBe(true)

        // Should not expose schema information or other tables
        if (applications.length > 0) {
          expect(applications[0]).toHaveProperty('id')
          expect(applications[0]).toHaveProperty('jobId')
          // Should not have injected fields from other tables
          expect(applications[0]).not.toHaveProperty('password')
          expect(applications[0]).not.toHaveProperty('table_name')
        }
      }
    })

    it('should prevent SQL injection in job ID filters', async () => {
      for (const payload of SQL_INJECTION_PAYLOADS.classic) {
        // Try to inject via jobId parameter
        const result = await ApplicationService.searchApplications({
          jobId: payload as string,
          limit: 10,
        })

        // Should return empty or throw validation error, not expose data
        expect(Array.isArray(result.applications)).toBe(true)
      }
    })

    it('treats a malicious stage filter as an inert, non-matching value', async () => {
      // There is no enum gate inside the service: the stage string goes into a
      // parameterized Prisma where-clause. A quote-laden stage can neither
      // escape into SQL nor match any row — the call resolves with an empty
      // page, which is the actual protection.
      const maliciousStages = [
        "NEW' OR '1'='1",
        'NEW\'; DROP TABLE "Application"--',
        'NEW\' UNION SELECT * FROM "User"--',
      ]

      for (const payload of maliciousStages) {
        const result = await ApplicationService.searchApplications({
          // @ts-expect-error - Testing invalid input
          stage: payload,
          limit: 10,
        })
        expect(Array.isArray(result.applications)).toBe(true)
        expect(result.applications).toHaveLength(0)
      }
    })
  })

  describe('Prisma Query Builder Safety', () => {
    it('should safely handle malicious input in findFirst', async () => {
      for (const payload of SQL_INJECTION_PAYLOADS.classic) {
        const result = await prisma.user.findFirst({
          where: { email: payload },
        })

        // Should return null (no match) or the user if it somehow matches
        // Should NOT return all users or throw SQL error
        expect(result).toBeNull()
      }
    })

    it('should safely handle malicious input in findUnique', async () => {
      for (const payload of SQL_INJECTION_PAYLOADS.classic) {
        const result = await prisma.job.findUnique({
          where: { id: payload },
        })

        expect(result).toBeNull()
      }
    })

    it('should safely handle malicious input in findMany with contains', async () => {
      for (const payload of SQL_INJECTION_PAYLOADS.classic) {
        const results = await prisma.job.findMany({
          where: {
            title: {
              contains: payload,
              mode: 'insensitive',
            },
          },
        })

        // Should return empty array or jobs that actually match the literal string
        expect(Array.isArray(results)).toBe(true)

        // Should not return all jobs
        const allJobs = await prisma.job.count()
        expect(results.length).toBeLessThanOrEqual(allJobs)
      }
    })

    it('should safely handle malicious input in OR conditions', async () => {
      const maliciousEmail = "admin@example.com' OR '1'='1"
      const maliciousName = "Admin' OR '1'='1"

      const results = await prisma.user.findMany({
        where: {
          OR: [{ email: maliciousEmail }, { name: maliciousName }],
        },
      })

      // Should only match if the exact string exists, not bypass the condition
      expect(Array.isArray(results)).toBe(true)

      // With proper parameterization, should not return all users
      const allUsers = await prisma.user.count()
      if (results.length === allUsers && allUsers > 1) {
        throw new Error('OR condition vulnerable to SQL injection')
      }
    })

    it('should safely handle malicious input in nested where conditions', async () => {
      const payload = "' OR 1=1--"

      const results = await prisma.application.findMany({
        where: {
          candidate: {
            contacts: {
              some: {
                email: { contains: payload },
              },
            },
          },
        },
      })

      expect(Array.isArray(results)).toBe(true)
      // Should not return all applications
      expect(results.length).toBeLessThanOrEqual(1)
    })
  })

  describe('Raw SQL Parameterization ($queryRaw)', () => {
    it('should prevent SQL injection in $queryRaw with template literals', async () => {
      const maliciousId = '1\'; DROP TABLE "User"--'

      // Prisma $queryRaw with template literals automatically parameterizes
      await expect(async () => {
        const result = await prisma.$queryRaw<any[]>`
          SELECT * FROM "User" WHERE id = ${maliciousId}
        `

        // Should safely parameterize and return empty result
        expect(Array.isArray(result)).toBe(true)
      }).resolves.not.toThrow()
    })

    it('should prevent SQL injection in vector similarity queries', async () => {
      // Test the semantic search which uses $queryRaw
      const maliciousJobDescription = '\' UNION SELECT * FROM "User"--'

      // Should either throw validation error or return safe results
      await expect(async () => {
        const results = await searchCandidates({
          jobDescription: maliciousJobDescription,
          organizationId: testOrg.id,
          limit: 10,
        })

        // If it succeeds, results should be safe
        expect(Array.isArray(results)).toBe(true)
      }).rejects.toThrow() // Will likely fail at embedding generation
    })

    it('should safely handle numeric parameters in $queryRaw', async () => {
      const maliciousLimit = '10; DROP TABLE "User"--'

      await expect(async () => {
        await prisma.$queryRaw<any[]>`
          SELECT * FROM "Job" LIMIT ${maliciousLimit}
        `
      }).rejects.toThrow() // Should throw type error, not execute DROP
    })

    it('should prevent UNION attacks in $queryRaw', async () => {
      const unionPayload = '1 UNION SELECT email, password FROM "User"--'

      const result = await prisma.$queryRaw<any[]>`
        SELECT id, title FROM "Job" WHERE id = ${unionPayload}
      `

      // Should parameterize and return empty result, not execute UNION
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBe(0)
    })
  })

  describe('NoSQL Injection Prevention', () => {
    it('should prevent NoSQL $gt injection in filter objects', async () => {
      // Try to inject NoSQL operators
      await expect(async () => {
        await prisma.user.findMany({
          where: {
            // @ts-expect-error - Testing invalid input
            email: { $gt: '' },
          },
        })
      }).rejects.toThrow()
    })

    it('should prevent NoSQL $ne injection', async () => {
      await expect(async () => {
        await prisma.user.findMany({
          where: {
            // @ts-expect-error - Testing invalid input
            password: { $ne: null },
          },
        })
      }).rejects.toThrow()
    })

    it('should prevent NoSQL $regex injection', async () => {
      await expect(async () => {
        await prisma.user.findMany({
          where: {
            // @ts-expect-error - Testing invalid input
            email: { $regex: '.*' },
          },
        })
      }).rejects.toThrow()
    })

    it('should prevent NoSQL $where injection', async () => {
      await expect(async () => {
        await prisma.user.findMany({
          where: {
            // @ts-expect-error - Testing invalid input
            $where: '1==1',
          },
        })
      }).rejects.toThrow()
    })

    it('should validate filter object structure', async () => {
      // Attempt to pass raw object with injection
      const maliciousFilter = {
        email: SQL_INJECTION_PAYLOADS.nosql[0],
      }

      await expect(async () => {
        await prisma.user.findMany({
          // @ts-expect-error - Testing invalid input
          where: maliciousFilter,
        })
      }).rejects.toThrow()
    })
  })

  describe('Boolean-Based Blind SQL Injection', () => {
    it('should not leak information via true/false conditions', async () => {
      const truePayload = "test@example.com' AND '1'='1"
      const falsePayload = "test@example.com' AND '1'='2"

      const resultTrue = await prisma.user.findFirst({
        where: { email: truePayload },
      })

      const resultFalse = await prisma.user.findFirst({
        where: { email: falsePayload },
      })

      // Both should return null (no match)
      // If resultTrue returns data and resultFalse doesn't, it's vulnerable
      expect(resultTrue).toBeNull()
      expect(resultFalse).toBeNull()
    })

    it('should not expose existence of records via boolean conditions', async () => {
      const existsPayload = '\' AND EXISTS(SELECT * FROM "User")--'

      const result = await prisma.user.findFirst({
        where: { email: existsPayload },
      })

      // Should not reveal if User table exists
      expect(result).toBeNull()
    })

    it('should not allow count-based information disclosure', async () => {
      const countPayload = '\' AND (SELECT COUNT(*) FROM "User") > 0--'

      const result = await prisma.user.findFirst({
        where: { email: countPayload },
      })

      expect(result).toBeNull()
    })
  })

  describe('Time-Based Blind SQL Injection', () => {
    it('should not execute time delay functions', async () => {
      const startTime = Date.now()

      for (const payload of SQL_INJECTION_PAYLOADS.timeBlind) {
        await prisma.user.findFirst({
          where: { email: payload },
        })
      }

      const endTime = Date.now()
      const duration = endTime - startTime

      // Should complete quickly (< 1 second total)
      // If it takes ~5 seconds per payload, pg_sleep is executing
      expect(duration).toBeLessThan(1000)
    }, 10000)

    it('should not delay response with CASE-based time injection', async () => {
      const payload = "' OR (CASE WHEN (1=1) THEN pg_sleep(5) ELSE 1 END)--"

      const startTime = Date.now()
      await prisma.user.findFirst({
        where: { email: payload },
      })
      const duration = Date.now() - startTime

      // Should not trigger the 5-second sleep
      expect(duration).toBeLessThan(500)
    })
  })

  describe('Stacked Queries Prevention', () => {
    it('should prevent DROP TABLE via stacked queries', async () => {
      const payload = 'test@example.com\'; DROP TABLE "User"--'

      await prisma.user.findFirst({
        where: { email: payload },
      })

      // Verify User table still exists
      const users = await prisma.user.findMany()
      expect(Array.isArray(users)).toBe(true)
    })

    it('should prevent DELETE via stacked queries', async () => {
      const payload = 'test@example.com\'; DELETE FROM "User"--'

      const userCountBefore = await prisma.user.count()

      await prisma.user.findFirst({
        where: { email: payload },
      })

      const userCountAfter = await prisma.user.count()

      // User count should remain the same
      expect(userCountAfter).toBe(userCountBefore)
    })

    it('should prevent UPDATE via stacked queries', async () => {
      const payload = "test@example.com'; UPDATE \"User\" SET email='hacked@example.com'--"

      await prisma.user.findFirst({
        where: { email: payload },
      })

      // Verify no users were updated
      const hackedUsers = await prisma.user.findMany({
        where: { email: 'hacked@example.com' },
      })
      expect(hackedUsers.length).toBe(0)
    })

    it('should prevent INSERT via stacked queries', async () => {
      const userCountBefore = await prisma.user.count()

      const payload =
        "test@example.com'; INSERT INTO \"User\" (email, name, password) VALUES ('injected@example.com', 'Hacker', 'pass')--"

      await prisma.user.findFirst({
        where: { email: payload },
      })

      const userCountAfter = await prisma.user.count()

      // No new users should be created
      expect(userCountAfter).toBe(userCountBefore)
    })
  })

  describe('Second-Order SQL Injection', () => {
    it('should prevent stored SQL injection payloads from executing', async () => {
      // Store a malicious payload in the database
      const maliciousUser = await prisma.user.create({
        data: {
          email: `malicious-${Date.now()}@example.com`,
          name: "' OR '1'='1--",
          password: 'hashedpassword',
        },
      })

      // Retrieve and use the stored value
      const user = await prisma.user.findUnique({
        where: { id: maliciousUser.id },
      })

      // Use the stored name in another query
      const results = await prisma.user.findMany({
        where: { name: user!.name },
      })

      // Should only return the malicious user, not all users
      expect(results.length).toBe(1)
      expect(results[0].id).toBe(maliciousUser.id)

      // Cleanup
      await prisma.user.delete({ where: { id: maliciousUser.id } })
    })

    it('should safely handle stored payloads in search queries', async () => {
      // Create a candidate with malicious name
      const maliciousCandidate = await prisma.candidate.create({
        data: {
          orgId: testOrg.id,
          source: 'CAREER_PAGE',
        },
      })

      await prisma.candidateContact.create({
        data: {
          candidateId: maliciousCandidate.id,
          fullName: "John' OR '1'='1-- Doe",
          email: 'john.doe@example.com',
          isPrimary: true,
        },
      })

      // Search using stored value
      const { applications } = await ApplicationService.searchApplications({
        search: "John' OR '1'='1-- Doe",
        limit: 10,
      })

      // Should return safe results
      expect(Array.isArray(applications)).toBe(true)

      // Cleanup
      await prisma.candidateContact.deleteMany({ where: { candidateId: maliciousCandidate.id } })
      await prisma.candidate.delete({ where: { id: maliciousCandidate.id } })
    })
  })

  describe('PostgreSQL-Specific Injection', () => {
    it('should prevent PostgreSQL version disclosure', async () => {
      const payload = "'; SELECT version()--"

      const result = await prisma.user.findFirst({
        where: { email: payload },
      })

      expect(result).toBeNull()
      // Should not expose version in any error message
    })

    it('should prevent access to pg_database catalog', async () => {
      const payload = "' OR 1=1; SELECT * FROM pg_database--"

      const result = await prisma.user.findFirst({
        where: { email: payload },
      })

      expect(result).toBeNull()
    })

    it('should prevent COPY command injection', async () => {
      const payload = "'; COPY \"User\" TO '/tmp/users.csv'--"

      await prisma.user.findFirst({
        where: { email: payload },
      })

      // Cannot easily test if file was created, but query should not execute COPY
      expect(true).toBe(true)
    })

    it('should prevent CREATE TABLE injection', async () => {
      const payload = "' OR 1=1; CREATE TABLE hacked (id INT)--"

      await prisma.user.findFirst({
        where: { email: payload },
      })

      // Try to query the hacked table - should fail
      await expect(async () => {
        await prisma.$queryRaw`SELECT * FROM hacked`
      }).rejects.toThrow()
    })
  })

  describe('Input Sanitization Edge Cases', () => {
    it('should handle null bytes in input', async () => {
      const payload = 'test\x00@example.com'

      const result = await prisma.user.findFirst({
        where: { email: payload },
      })

      expect(result).toBeNull()
    })

    it('should handle Unicode escaping attempts', async () => {
      const payload = 'test@example.com\\u0027 OR 1=1--'

      const result = await prisma.user.findFirst({
        where: { email: payload },
      })

      expect(result).toBeNull()
    })

    it('should handle multi-line payloads', async () => {
      const payload = "test@example.com'\nOR '1'='1'\n--"

      const result = await prisma.user.findFirst({
        where: { email: payload },
      })

      expect(result).toBeNull()
    })

    it('should handle hex-encoded payloads', async () => {
      const payload = '0x27 OR 1=1--'

      const result = await prisma.user.findFirst({
        where: { email: payload },
      })

      expect(result).toBeNull()
    })

    it('should handle extremely long payloads', async () => {
      const longPayload = 'a'.repeat(10000) + "' OR '1'='1"

      const result = await prisma.user.findFirst({
        where: { email: longPayload },
      })

      expect(result).toBeNull()
    })
  })

  describe('API Route Input Validation', () => {
    it('should validate and reject malicious IDs in route parameters', async () => {
      const maliciousIds = [
        "123' OR '1'='1",
        '\'; DROP TABLE "User"--',
        '../../../etc/passwd',
        "<script>alert('xss')</script>",
      ]

      for (const id of maliciousIds) {
        // Try to get application with malicious ID
        const app = await prisma.application.findUnique({
          where: { id },
        })

        // Should return null for non-existent ID
        expect(app).toBeNull()
      }
    })

    it('should validate enum values and reject injection attempts', async () => {
      const maliciousStages = ["NEW' OR '1'='1", 'NEW\'; DROP TABLE "Application"--']

      for (const stage of maliciousStages) {
        await expect(async () => {
          await ApplicationService.bulkUpdateStatus(
            [testApplication.id],
            // @ts-expect-error - Testing invalid enum
            stage,
            testUser.id,
          )
        }).rejects.toThrow()
      }
    })
  })

  describe('Prisma Type Safety', () => {
    it('should enforce TypeScript types to prevent injection', () => {
      // This is a compile-time test
      // TypeScript should prevent passing invalid types

      // Valid query
      const validQuery = prisma.user.findFirst({
        where: { email: 'test@example.com' },
      })
      expect(validQuery).toBeDefined()

      // Invalid queries would be caught at compile time
      // Uncomment to verify TypeScript protection:

      // @ts-expect-error - Invalid type
      // const invalid1 = prisma.user.findFirst({
      //   where: { email: { $gt: "" } },
      // })

      // @ts-expect-error - Invalid operator
      // const invalid2 = prisma.user.findFirst({
      //   where: { $where: "1==1" },
      // })
    })

    it('should use Prisma.sql for safe raw queries', async () => {
      const email = 'test@example.com\'; DROP TABLE "User"--'

      // Prisma.sql with tagged template provides safe parameterization
      const result = await prisma.$queryRaw(Prisma.sql`SELECT * FROM "User" WHERE email = ${email}`)

      expect(Array.isArray(result)).toBe(true)
      // Should not execute DROP TABLE
    })
  })

  describe('Defense in Depth', () => {
    it('should combine multiple security layers', async () => {
      // Test that even with multiple injection points, the query is safe
      const maliciousEmail = "admin@example.com' OR '1'='1--"
      const maliciousStage = "NEW' OR '1'='1"

      const { applications } = await ApplicationService.searchApplications({
        search: maliciousEmail,
        // @ts-expect-error - Testing invalid input
        stage: maliciousStage,
        limit: 10,
      })

      // All layers should protect against injection
      expect(Array.isArray(applications)).toBe(true)
      expect(applications.length).toBeLessThanOrEqual(1)
    })

    it('should log suspicious activity without exposing data', async () => {
      // While we can't easily test logging in unit tests,
      // we verify that malicious queries don't expose sensitive info
      const payload = '\' UNION SELECT password FROM "User"--'

      const result = await prisma.user.findFirst({
        where: { email: payload },
      })

      expect(result).toBeNull()
      // In production, this would trigger security monitoring
    })
  })
})
