import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UnauthorizedError } from '@/lib/api-helpers'
import { POST } from '@/app/api/assessments/route'
import {
  createTestRequest,
  createRecruiterSession,
  createOrgAdminSession,
  createCandidateSession,
  parseResponse,
} from '../../helpers/api-client'
import { prisma, TEST_IDS } from '../../helpers/test-db'

/**
 * Integration tests for POST /api/assessments
 * Tests assessment creation with nested sections and questions
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
  requireAuth: vi.fn(async () => {
    const session = await mockAuthFn()
    if (!session?.user?.id) {
      // UnauthorizedError, not a bare Error: handleApiError maps the former to
      // 401 and everything else to 500. With the module previously mocked away
      // wholesale this never got far enough to matter; now it does.
      throw new UnauthorizedError()
    }
    return session
  }),
}))

describe('POST /api/assessments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(null)

      const request = createTestRequest('POST', {
        name: 'JavaScript Test',
        durationMin: 60,
        passingScore: 70,
        sections: [],
      })

      // Act
      const response = await POST(request)

      // Assert
      expect(response.status).toBe(401)

      // Verify no assessment was created
      const assessments = await prisma.assessment.findMany({
        where: { name: 'JavaScript Test' },
      })
      expect(assessments).toHaveLength(0)
    })

    it('should reject candidate users', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createCandidateSession())

      const request = createTestRequest('POST', {
        name: 'JavaScript Test',
        durationMin: 60,
        passingScore: 70,
        sections: [],
      })

      // Act
      const response = await POST(request)

      // Assert
      expect(response.status).toBe(403)
      const data = await parseResponse(response)
      expect(data.error).toContain('organization')
    })
  })

  describe('Authorization', () => {
    it('should allow org admin to create assessment', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createOrgAdminSession())

      const request = createTestRequest('POST', {
        name: 'JavaScript Skills Test',
        description: 'Test for React developers',
        durationMin: 60,
        passingScore: 70,
        locale: 'en',
        sections: [
          {
            title: 'Basics',
            questions: [
              {
                type: 'MCQ',
                text: 'What is a closure?',
                choices: ['Option A', 'Option B', 'Option C'],
                correctIndexes: [0],
                points: 10,
              },
            ],
          },
        ],
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)
      expect(data.assessment).toBeDefined()
      expect(data.assessment.name).toBe('JavaScript Skills Test')
      expect(data.assessment.orgId).toBe(TEST_IDS.org)
      expect(data.assessment.sections).toHaveLength(1)
      expect(data.assessment.sections[0].questions).toHaveLength(1)

      // Verify assessment was created in database
      const assessment = await prisma.assessment.findUnique({
        where: { id: data.assessment.id },
        include: {
          sections: {
            include: { questions: true },
          },
        },
      })
      expect(assessment).toBeTruthy()
      expect(assessment?.createdBy).toBe(TEST_IDS.admin)
      expect(assessment?.sections).toHaveLength(1)
      expect(assessment?.sections[0].questions).toHaveLength(1)
    })

    it('should allow recruiter to create assessment', async () => {
      // Arrange
      mockAuthFn.mockResolvedValue(createRecruiterSession())

      const request = createTestRequest('POST', {
        name: 'TypeScript Test',
        durationMin: 45,
        passingScore: 80,
        sections: [
          {
            title: 'Advanced Topics',
            questions: [
              {
                type: 'CODE',
                text: 'Write a function to sum two numbers',
                language: 'typescript',
                points: 20,
              },
            ],
          },
        ],
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)
      expect(data.assessment.name).toBe('TypeScript Test')
      expect(data.assessment.createdBy).toBe(TEST_IDS.recruiter)
    })
  })

  describe('Validation', () => {
    beforeEach(() => {
      mockAuthFn.mockResolvedValue(createRecruiterSession())
    })

    it('should reject missing required fields', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        // Missing name, durationMin, passingScore
        sections: [],
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(400)
      expect(data.error).toBeTruthy()
    })

    it('should reject invalid duration', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        name: 'Test Assessment',
        durationMin: -10, // Negative duration
        passingScore: 70,
        sections: [],
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert — the route returns a fixed `error` and the per-field detail in
      // `issues`; the field name is never interpolated into `error`.
      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation failed')
      expect(data.issues.some((i: any) => i.path.includes('durationMin'))).toBe(true)
    })

    it('should reject invalid passing score', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        name: 'Test Assessment',
        durationMin: 60,
        passingScore: 150, // > 100
        sections: [],
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(400)
      expect(data.error).toBe('Validation failed')
      expect(data.issues.some((i: any) => i.path.includes('passingScore'))).toBe(true)
    })

    it('should reject invalid question type', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        name: 'Test Assessment',
        durationMin: 60,
        passingScore: 70,
        sections: [
          {
            title: 'Section 1',
            questions: [
              {
                type: 'INVALID_TYPE', // Invalid type
                text: 'Test question',
              },
            ],
          },
        ],
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(400)
      expect(data.error).toBeTruthy()
    })
  })

  describe('Assessment Creation', () => {
    beforeEach(() => {
      mockAuthFn.mockResolvedValue(createRecruiterSession())
    })

    it('should create assessment with multiple sections', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        name: 'Comprehensive Test',
        description: 'Multi-section assessment',
        durationMin: 90,
        passingScore: 75,
        sections: [
          {
            title: 'Section 1',
            description: 'Basic questions',
            questions: [
              {
                type: 'MCQ',
                text: 'Question 1',
                choices: ['A', 'B', 'C'],
                correctIndexes: [0],
                points: 10,
              },
            ],
          },
          {
            title: 'Section 2',
            description: 'Advanced questions',
            questions: [
              {
                type: 'CODE',
                text: 'Question 2',
                language: 'javascript',
                points: 20,
              },
            ],
          },
        ],
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)
      expect(data.assessment.sections).toHaveLength(2)
      expect(data.assessment.sections[0].title).toBe('Section 1')
      expect(data.assessment.sections[1].title).toBe('Section 2')

      // Verify in database
      const assessment = await prisma.assessment.findUnique({
        where: { id: data.assessment.id },
        include: {
          sections: {
            include: { questions: true },
            orderBy: { order: 'asc' },
          },
        },
      })
      expect(assessment?.sections).toHaveLength(2)
    })

    it('should create assessment with multiple question types', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        name: 'Mixed Question Types',
        durationMin: 60,
        passingScore: 70,
        sections: [
          {
            title: 'Mixed Section',
            questions: [
              {
                type: 'MCQ',
                text: 'Multiple choice question',
                choices: ['A', 'B', 'C'],
                correctIndexes: [0],
                points: 10,
              },
              {
                type: 'MULTI_SELECT',
                text: 'Multi-select question',
                choices: ['A', 'B', 'C', 'D'],
                correctIndexes: [0, 2],
                points: 15,
              },
              {
                type: 'SHORT_TEXT',
                text: 'Short answer question',
                points: 10,
              },
              {
                type: 'LONG_TEXT',
                text: 'Essay question',
                points: 20,
              },
              {
                type: 'CODE',
                text: 'Coding challenge',
                language: 'python',
                code: 'def solution():\n    pass',
                points: 30,
              },
            ],
          },
        ],
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)
      expect(data.assessment.sections[0].questions).toHaveLength(5)

      const questions = data.assessment.sections[0].questions
      expect(questions[0].type).toBe('MCQ')
      expect(questions[1].type).toBe('MULTI_SELECT')
      expect(questions[2].type).toBe('SHORT_TEXT')
      expect(questions[3].type).toBe('LONG_TEXT')
      expect(questions[4].type).toBe('CODE')
    })

    it('should preserve question order', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        name: 'Ordered Assessment',
        durationMin: 60,
        passingScore: 70,
        sections: [
          {
            title: 'Section 1',
            questions: [
              {
                type: 'SHORT_TEXT',
                text: 'Question 1',
                order: 0,
                points: 10,
              },
              {
                type: 'SHORT_TEXT',
                text: 'Question 2',
                order: 1,
                points: 10,
              },
              {
                type: 'SHORT_TEXT',
                text: 'Question 3',
                order: 2,
                points: 10,
              },
            ],
          },
        ],
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)

      const assessment = await prisma.assessment.findUnique({
        where: { id: data.assessment.id },
        include: {
          sections: {
            include: {
              questions: {
                orderBy: { order: 'asc' },
              },
            },
          },
        },
      })

      const questions = assessment?.sections[0].questions
      expect(questions?.[0].text).toBe('Question 1')
      expect(questions?.[1].text).toBe('Question 2')
      expect(questions?.[2].text).toBe('Question 3')
    })

    // `sections: z.array(...).min(1)` — an assessment with no sections is not a
    // valid assessment, so these cases cannot post an empty array and expect 201.
    it('should default isPublished to false', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        name: 'Unpublished Assessment',
        durationMin: 60,
        passingScore: 70,
        sections: [
          {
            title: 'Section 1',
            questions: [{ type: 'SHORT_TEXT', text: 'Why do you want this role?' }],
          },
        ],
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)
      expect(data.assessment.isPublished).toBe(false)

      const assessment = await prisma.assessment.findUnique({
        where: { id: data.assessment.id },
      })
      expect(assessment?.isPublished).toBe(false)
    })

    it('should store MCQ correct answers', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        name: 'MCQ Test',
        durationMin: 30,
        passingScore: 60,
        sections: [
          {
            title: 'Section 1',
            questions: [
              {
                type: 'MCQ',
                text: 'What is the capital of France?',
                choices: ['London', 'Paris', 'Berlin', 'Madrid'],
                correctIndexes: [1],
                points: 10,
              },
            ],
          },
        ],
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)

      const assessment = await prisma.assessment.findUnique({
        where: { id: data.assessment.id },
        include: {
          sections: {
            include: { questions: true },
          },
        },
      })

      const question = assessment?.sections[0].questions[0]
      expect(question?.choices).toEqual(['London', 'Paris', 'Berlin', 'Madrid'])
      expect(question?.correctIndexes).toEqual([1])
    })

    it('should store code question details', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        name: 'Code Assessment',
        durationMin: 60,
        passingScore: 70,
        sections: [
          {
            title: 'Coding',
            questions: [
              {
                type: 'CODE',
                text: 'Implement a binary search',
                language: 'python',
                code: 'def binary_search(arr, target):\n    # Your code here\n    pass',
                // `rubric` is z.record(z.any()) — a JSON object, not a sentence.
                rubric: { criteria: ['Must handle edge cases', 'O(log n) complexity'] },
                points: 30,
              },
            ],
          },
        ],
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)

      const assessment = await prisma.assessment.findUnique({
        where: { id: data.assessment.id },
        include: {
          sections: {
            include: { questions: true },
          },
        },
      })

      const question = assessment?.sections[0].questions[0]
      expect(question?.language).toBe('python')
      // The column is starterCode; the request field is `code` and the route maps it.
      expect(question?.starterCode).toContain('binary_search')
      expect(question?.rubric).toMatchObject({
        criteria: ['Must handle edge cases', 'O(log n) complexity'],
      })
    })
  })

  describe('Settings', () => {
    beforeEach(() => {
      mockAuthFn.mockResolvedValue(createRecruiterSession())
    })

    it('should store randomize setting', async () => {
      // Arrange
      const request = createTestRequest('POST', {
        name: 'Randomized Assessment',
        durationMin: 60,
        passingScore: 70,
        randomize: true,
        sections: [
          {
            title: 'Section 1',
            questions: [{ type: 'SHORT_TEXT', text: 'Why do you want this role?' }],
          },
        ],
      })

      // Act
      const response = await POST(request)
      const data = await parseResponse(response)

      // Assert
      expect(response.status).toBe(201)

      const assessment = await prisma.assessment.findUnique({
        where: { id: data.assessment.id },
      })

      expect(assessment?.settings).toMatchObject({
        randomize: true,
      })
    })
  })
})
