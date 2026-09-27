import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/candidates/search/route'
import {
  createTestRequest,
  createRecruiterSession,
  createCandidateSession,
  parseResponse,
} from '../../helpers/api-client'
import {
  prisma,
  TEST_IDS,
  createTestJob,
  createTestCandidate,
  createTestOrganization,
} from '../../helpers/test-db'

/**
 * Integration tests for POST /api/candidates/search
 * Tests semantic candidate search for job matching
 */

// Mock NextAuth
const { mockAuthFn } = vi.hoisted(() => ({
  mockAuthFn: vi.fn(),
}))

// Partial mock. lib/errors.ts reaches UnauthorizedError through @/lib/auth, so
// replacing the module wholesale makes handleApiError throw while handling an
// error — which is every validation and auth path in these files.
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  auth: mockAuthFn,
}))

// Mock semantic search function
const { mockSearchCandidates } = vi.hoisted(() => ({
  mockSearchCandidates: vi.fn(),
}))

vi.mock('@/lib/semantic-search', () => ({
  searchCandidates: mockSearchCandidates,
}))

describe('POST /api/candidates/search', () => {
  // TEST_IDS has no `job` key — it never has — so every `jobId: TEST_IDS.job`
  // in this file sent `undefined`, JSON.stringify dropped it, and the route
  // answered 400 "jobId required". That is the whole of the "expected 400 to
  // be 200" cluster. A real job, created per test, fixes all of them.
  let testJobId: string

  beforeEach(async () => {
    vi.clearAllMocks()

    // Default: return empty matches
    mockSearchCandidates.mockResolvedValue([])

    const job = await createTestJob()
    testJobId = job.id
  })

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(null)

      const request = createTestRequest('POST', {
        jobId: testJobId,
      })

      // Act
      const response = await POST(request)

      // Assert
      expect(response.status).toBe(401)
      const data = await parseResponse(response)
      expect(data.error).toContain('Unauthorized')

      // Verify search was not performed
      expect(mockSearchCandidates).not.toHaveBeenCalled()
    })

    it('should reject candidate users without organization', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createCandidateSession())

      const request = createTestRequest('POST', {
        jobId: testJobId,
      })

      // Act
      const response = await POST(request)

      // Assert
      expect(response.status).toBe(403)
      const data = await parseResponse(response)
      expect(data.error).toContain('organization')
    })
  })

  describe('Validation', () => {
    beforeEach(() => {
      mockAuthFn.mockResolvedValue(createRecruiterSession())
    })

    it('should reject missing jobId', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        // jobId is missing
        limit: 10,
      })

      // Act
      const response = await POST(request)

      // Assert
      expect(response.status).toBe(400)
      const data = await parseResponse(response)
      expect(data.error).toContain('Invalid request')
    })

    it('should reject invalid limit (> 100)', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        jobId: testJobId,
        limit: 150, // Exceeds max
      })

      // Act
      const response = await POST(request)

      // Assert
      expect(response.status).toBe(400)
      const data = await parseResponse(response)
      expect(data.error).toContain('Invalid request')
    })

    it('should reject invalid minSimilarity (> 1)', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        jobId: testJobId,
        minSimilarity: 1.5, // > 1
      })

      // Act
      const response = await POST(request)

      // Assert
      expect(response.status).toBe(400)
      const data = await parseResponse(response)
      expect(data.error).toContain('Invalid request')
    })

    it('should reject invalid minSimilarity (< 0)', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        jobId: testJobId,
        minSimilarity: -0.5, // < 0
      })

      // Act
      const response = await POST(request)

      // Assert
      expect(response.status).toBe(400)
      const data = await parseResponse(response)
      expect(data.error).toContain('Invalid request')
    })
  })

  describe('Authorization', () => {
    it('should reject access to job from different organization', async () => {
      // The route resolves the caller's membership against the JOB'S organization
      // in the database — the orgId on the session is never consulted. Overriding
      // it on the mock session (the old approach) proves nothing: the seeded
      // recruiter is still a member of the job's org in the database, so the route
      // correctly returned 200. What actually exercises the boundary is a job
      // owned by an organisation the recruiter does not belong to.
      const otherOrg = await createTestOrganization(
        'Search Foreign Org',
        `search-foreign-${Date.now()}`,
      )
      let foreignJob: { id: string } | null = null
      try {
        foreignJob = await createTestJob({ orgId: otherOrg.id })
        mockAuthFn.mockResolvedValue(createRecruiterSession()) // member of TEST_IDS.org only

        const request = createTestRequest('POST', {
          jobId: foreignJob.id,
        })

        // Act
        const response = await POST(request)

        // Assert
        expect(response.status).toBe(403)
        const data = await parseResponse(response)
        expect(data.error).toContain('Forbidden')
        expect(mockSearchCandidates).not.toHaveBeenCalled()
      } finally {
        // The global cleanup only removes rows scoped to TEST_IDS.org, so this
        // foreign pair would otherwise survive into the next run.
        if (foreignJob) await prisma.job.delete({ where: { id: foreignJob.id } }).catch(() => {})
        await prisma.organization.delete({ where: { id: otherOrg.id } }).catch(() => {})
      }
    })

    it('should allow recruiter from same organization', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      mockSearchCandidates.mockResolvedValue([
        {
          candidateId: 'candidate-1',
          resumeId: 'resume-1',
          resumeTitle: 'Software Engineer',
          similarity: 0.85,
        },
      ])

      const request = createTestRequest('POST', {
        jobId: testJobId,
      })

      // Act
      const response = await POST(request)

      // Assert
      expect(response.status).toBe(200)
      const data = await parseResponse(response)
      expect(data.success).toBe(true)
      expect(data.jobId).toBe(testJobId)
    })
  })

  describe('Job Existence', () => {
    beforeEach(() => {
      mockAuthFn.mockResolvedValue(createRecruiterSession())
    })

    it('should return 404 for non-existent job', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        jobId: 'non-existent-job-id',
      })

      // Act
      const response = await POST(request)

      // Assert
      expect(response.status).toBe(404)
      const data = await parseResponse(response)
      expect(data.error).toContain('not found')
    })
  })

  describe('Candidate Search', () => {
    beforeEach(() => {
      mockAuthFn.mockResolvedValue(createRecruiterSession())
    })

    it('should search candidates with default parameters', async () => {
      // Arrange
      mockSearchCandidates.mockResolvedValue([
        {
          candidateId: 'candidate-1',
          resumeId: 'resume-1',
          resumeTitle: 'Senior React Developer',
          similarity: 0.92,
          matchedSection: {
            type: 'EXPERIENCE',
            content: '5 years of React development...',
          },
        },
      ])

      const request = createTestRequest('POST', {
        jobId: testJobId,
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.totalMatches).toBe(1)
      expect(data.matches).toHaveLength(1)
      expect(data.matches[0].similarity).toBe(0.92)

      // Verify search was called with correct parameters
      expect(mockSearchCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: TEST_IDS.org,
          limit: 10, // Default
          minSimilarity: 0.5, // Default
          includeDetails: true, // Default
        }),
      )
    })

    it('should search candidates with custom parameters', async () => {
      // Arrange
      mockSearchCandidates.mockResolvedValue([])

      const request = createTestRequest('POST', {
        jobId: testJobId,
        limit: 5,
        minSimilarity: 0.8,
        includeDetails: false,
      })

      // Act
      const response = await POST(request)
      await parseResponse(response)

      // Assert
      expect(response.status).toBe(200)

      // Verify search was called with custom parameters
      expect(mockSearchCandidates).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 5,
          minSimilarity: 0.8,
          includeDetails: false,
        }),
      )
    })

    it('should return multiple matching candidates', async () => {
      // Arrange
      mockSearchCandidates.mockResolvedValue([
        {
          candidateId: 'candidate-1',
          resumeId: 'resume-1',
          resumeTitle: 'Senior Developer',
          similarity: 0.95,
        },
        {
          candidateId: 'candidate-2',
          resumeId: 'resume-2',
          resumeTitle: 'Full Stack Engineer',
          similarity: 0.88,
        },
        {
          candidateId: 'candidate-3',
          resumeId: 'resume-3',
          resumeTitle: 'React Specialist',
          similarity: 0.82,
        },
      ])

      const request = createTestRequest('POST', {
        jobId: testJobId,
        limit: 10,
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(200)
      expect(data.totalMatches).toBe(3)
      expect(data.matches).toHaveLength(3)

      // Verify candidates are in order
      expect(data.matches[0].similarity).toBeGreaterThan(data.matches[1].similarity)
      expect(data.matches[1].similarity).toBeGreaterThan(data.matches[2].similarity)
    })

    it('should return empty array when no candidates match', async () => {
      // Arrange
      mockSearchCandidates.mockResolvedValue([])

      const request = createTestRequest('POST', {
        jobId: testJobId,
        minSimilarity: 0.99, // Very high threshold
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.totalMatches).toBe(0)
      expect(data.matches).toHaveLength(0)
    })

    it('should filter out candidates who already applied', async () => {
      // Arrange
      // A real Candidate row: the FK is enforced, so a made-up string id was
      // always going to be P2003. Application also needs orgId, and the column
      // is `stage`, not `status` — `appliedAt` does not exist at all.
      const appliedCandidate = await createTestCandidate()
      const appliedCandidateId = appliedCandidate.id

      mockSearchCandidates.mockResolvedValue([
        {
          candidateId: 'candidate-1',
          resumeId: 'resume-1',
          resumeTitle: 'Developer',
          similarity: 0.9,
        },
        {
          candidateId: appliedCandidateId, // This one already applied
          resumeId: 'resume-applied',
          resumeTitle: 'Developer',
          similarity: 0.85,
        },
        {
          candidateId: 'candidate-2',
          resumeId: 'resume-2',
          resumeTitle: 'Developer',
          similarity: 0.8,
        },
      ])

      await prisma.application.create({
        data: {
          jobId: testJobId,
          candidateId: appliedCandidate.id,
          orgId: TEST_IDS.org,
          stage: 'NEW',
        },
      })

      const request = createTestRequest('POST', {
        jobId: testJobId,
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(200)
      expect(data.totalMatches).toBe(2) // candidate-applied is filtered out
      expect(data.matches).toHaveLength(2)
      expect(data.matches.find((m: any) => m.candidateId === appliedCandidateId)).toBeUndefined()
    })

    it('should include contact information when available', async () => {
      // Arrange
      // Again a real Candidate: CandidateContact.candidateId is a foreign key.
      const contactCandidate = await createTestCandidate()
      const candidateId = contactCandidate.id

      await prisma.candidateContact.create({
        data: {
          candidateId,
          fullName: 'John Doe',
          email: 'john@example.com',
          location: 'San Francisco, CA',
          availableFrom: new Date('2024-01-01'),
          isPrimary: true,
        },
      })

      mockSearchCandidates.mockResolvedValue([
        {
          candidateId,
          resumeId: 'resume-1',
          resumeTitle: 'Developer',
          similarity: 0.9,
        },
      ])

      const request = createTestRequest('POST', {
        jobId: testJobId,
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(200)
      expect(data.matches).toHaveLength(1)
      expect(data.matches[0].contact).toBeDefined()
      expect(data.matches[0].contact.fullName).toBe('John Doe')
      expect(data.matches[0].contact.email).toBe('john@example.com')
      expect(data.matches[0].contact.location).toBe('San Francisco, CA')
    })

    it('should handle candidates without contact information', async () => {
      // Arrange
      mockSearchCandidates.mockResolvedValue([
        {
          candidateId: 'candidate-no-contact',
          resumeId: 'resume-1',
          resumeTitle: 'Developer',
          similarity: 0.9,
        },
      ])

      const request = createTestRequest('POST', {
        jobId: testJobId,
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(200)
      expect(data.matches).toHaveLength(1)
      expect(data.matches[0].contact).toBeUndefined()
    })
  })

  describe('Response Format', () => {
    beforeEach(() => {
      mockAuthFn.mockResolvedValue(createRecruiterSession())
    })

    it('should return correct response structure', async () => {
      // Arrange
      mockSearchCandidates.mockResolvedValue([
        {
          candidateId: 'candidate-1',
          resumeId: 'resume-1',
          resumeTitle: 'Developer',
          similarity: 0.9,
          matchedSection: {
            type: 'SKILLS',
            content: 'React, TypeScript, Node.js',
          },
        },
      ])

      const request = createTestRequest('POST', {
        jobId: testJobId,
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(data).toMatchObject({
        success: true,
        jobId: expect.any(String),
        jobTitle: expect.any(String),
        totalMatches: expect.any(Number),
        matches: expect.arrayContaining([
          expect.objectContaining({
            candidateId: expect.any(String),
            resumeId: expect.any(String),
            resumeTitle: expect.any(String),
            similarity: expect.any(Number),
          }),
        ]),
      })
    })

    it('should include matched section when available', async () => {
      // Arrange
      mockSearchCandidates.mockResolvedValue([
        {
          candidateId: 'candidate-1',
          resumeId: 'resume-1',
          resumeTitle: 'Developer',
          similarity: 0.9,
          matchedSection: {
            type: 'EXPERIENCE',
            content: 'Senior React Developer at Tech Corp',
          },
        },
      ])

      const request = createTestRequest('POST', {
        jobId: testJobId,
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(data.matches[0].matchedSection).toBeDefined()
      expect(data.matches[0].matchedSection.type).toBe('EXPERIENCE')
      expect(data.matches[0].matchedSection.content).toContain('React Developer')
    })
  })
})
