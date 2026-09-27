/**
 * Integration Tests for Assessment Grading Worker
 * Tests assessment grading with real Redis and BullMQ
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Queue, Worker, Job } from 'bullmq'
import IORedis from 'ioredis'
import { prisma, TEST_IDS, createTestCandidateWithContact } from '../helpers/test-db'
import type { AssessmentJobData } from '@/lib/queue'

// Mock Anthropic to prevent actual API calls.
//
// `messages` lives on the PROTOTYPE, not as a class field. The worker builds its
// Anthropic instance at module scope, and two tests below reach it through
// `vi.spyOn(Anthropic.prototype.messages, 'create')`. As an own field per
// instance, `Anthropic.prototype.messages` was undefined and every one of those
// calls died with "spyOn could not find an object to spy upon".
const { anthropicCreate } = vi.hoisted(() => ({ anthropicCreate: vi.fn() }))

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {}
  ;(Anthropic.prototype as any).messages = { create: anthropicCreate }
  return { default: Anthropic }
})

const DEFAULT_CLAUDE_RESPONSE = {
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        score: 85,
        feedback: 'Good solution with proper logic and clean code.',
        passedTests: 4,
        totalTests: 5,
      }),
    },
  ],
}

// Mock email service
vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

describe('Assessment Grading Worker Integration Tests', () => {
  let connection: IORedis
  let assessmentQueue: Queue<AssessmentJobData>
  let worker: Worker<AssessmentJobData>
  let assessment: any
  let section: any
  let candidate: any
  let invite: any
  let attempt: any

  beforeEach(async () => {
    // One shared mock function now backs every Anthropic instance, so restore its
    // default behaviour before each test (a spyOn/mockRejectedValue in one test
    // would otherwise bleed into the next).
    vi.restoreAllMocks()
    anthropicCreate.mockReset()
    anthropicCreate.mockResolvedValue(DEFAULT_CLAUDE_RESPONSE)

    // Setup Redis connection
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })

    // Create test queue
    assessmentQueue = new Queue<AssessmentJobData>('assessments-test', {
      connection,
    })

    // Clean existing jobs
    await assessmentQueue.drain()
    await assessmentQueue.clean(0, 100, 'completed')
    await assessmentQueue.clean(0, 100, 'failed')

    // Create test data
    assessment = await prisma.assessment.create({
      data: {
        name: 'JavaScript Fundamentals Test',
        orgId: TEST_IDS.org,
        description: 'Test your JavaScript knowledge',
        // The schema calls these durationMin and isPublished, and createdBy is
        // required — this create had been failing in beforeEach, which is why
        // every test in the file went down with it.
        durationMin: 60,
        isPublished: true,
        createdBy: TEST_IDS.recruiter,
      },
    })

    section = await prisma.assessmentSection.create({
      data: {
        assessmentId: assessment.id,
        title: 'Core Concepts',
        description: 'Test core JavaScript concepts',
        order: 1,
      },
    })

    const result = await createTestCandidateWithContact({
      email: 'test-candidate@example.com',
      fullName: 'Jane Doe',
    })
    candidate = result.candidate

    invite = await prisma.assessmentInvite.create({
      data: {
        assessmentId: assessment.id,
        candidateId: candidate.id,
        // token is String @unique with no default — required.
        token: `test-invite-token-1`,
        status: 'SENT',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
  })

  afterEach(async () => {
    // Stop worker if running
    if (worker) {
      await worker.close()
    }

    // Clean up queue
    await assessmentQueue.drain()
    await assessmentQueue.close()
    await connection.quit()

    // Clean up database
    if (attempt) {
      await prisma.answer.deleteMany({
        where: { attemptId: attempt.id },
      })
      await prisma.attempt.deleteMany({
        where: { id: attempt.id },
      })
    }

    await prisma.assessmentInvite.deleteMany({
      where: { id: invite.id },
    })
    await prisma.question.deleteMany({
      where: { sectionId: section.id },
    })
    await prisma.assessmentSection.deleteMany({
      where: { id: section.id },
    })
    await prisma.assessment.deleteMany({
      where: { id: assessment.id },
    })
    await prisma.candidateContact.deleteMany({
      where: { candidateId: candidate.id },
    })
    await prisma.candidate.deleteMany({
      where: { id: candidate.id },
    })
  })

  describe('Job Enqueueing', () => {
    it('should successfully enqueue assessment grading job', async () => {
      // Arrange
      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      // Act
      const job = await assessmentQueue.add(
        'grade-assessment',
        {
          attemptId: attempt.id,
        },
        { priority: 1 },
      )

      // Assert
      expect(job.id).toBeDefined()
      expect(job.data.attemptId).toBe(attempt.id)
      expect(job.opts.priority).toBe(1)

      // BullMQ 5 keeps prioritised jobs in their own `prioritized` set, not in
      // `wait` — getWaitingCount() is 0 for a job added with a priority, which is
      // why this asserted 1 and got 0. Count both so the assertion says what it
      // means: exactly one job is queued and not yet picked up.
      const counts = await assessmentQueue.getJobCounts('wait', 'prioritized')
      expect((counts.wait ?? 0) + (counts.prioritized ?? 0)).toBe(1)
    })

    it('should set high priority for grading jobs', async () => {
      // Arrange
      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      // Act
      const job = await assessmentQueue.add(
        'grade-assessment',
        { attemptId: attempt.id },
        { priority: 1 },
      )

      // Assert
      expect(job.opts.priority).toBe(1)
    })
  })

  describe('Job Processing - Multiple Choice', () => {
    it('should correctly grade multiple choice questions', async () => {
      // Arrange
      const question = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'MCQ',
          text: 'What is the output of typeof null?',
          choices: ['null', 'undefined', 'object', 'number'],
          correctIndexes: [2], // 'object' is correct
          points: 10,
          order: 1,
        },
      })

      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          response: { answer: 'object' }, // Correct answer
        },
      })

      await assessmentQueue.add('grade-assessment', {
        attemptId: attempt.id,
      })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert
      expect(completed.returnvalue.success).toBe(true)
      expect(completed.returnvalue.totalScore).toBe(10)
      expect(completed.returnvalue.maxScore).toBe(10)
      expect(completed.returnvalue.percentage).toBe(100)

      const updatedAttempt = await prisma.attempt.findUnique({
        where: { id: attempt.id },
      })

      expect(updatedAttempt?.status).toBe('GRADED')
      expect(updatedAttempt?.totalScore).toBe(10)
      expect(updatedAttempt?.percentage).toBe(100)
    })

    // Regression: MULTI_SELECT is one of the five types the app writes
    // (schemas/assessment.schema.ts), but questionTypeMap keyed on 'MULTI' — a
    // spelling nothing produces — so these answers fell through to FREE_TEXT and
    // were filed as "Pending manual review" worth 0, pulling the whole attempt's
    // percentage down. Both the exact-set and the partial-answer cases are pinned.
    it('grades a MULTI_SELECT answer on the exact set of choices', async () => {
      const question = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'MULTI_SELECT',
          text: 'Which of these are falsy in JavaScript?',
          choices: ['0', '"0"', 'null', '[]'],
          correctIndexes: [0, 2],
          points: 10,
          order: 1,
        },
      })

      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          // The runner stores an array of choice texts.
          response: ['0', 'null'],
        },
      })

      await assessmentQueue.add('grade-assessment', { attemptId: attempt.id })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      expect(completed.returnvalue.totalScore).toBe(10)
      expect(completed.returnvalue.percentage).toBe(100)

      const answer = await prisma.answer.findFirst({ where: { attemptId: attempt.id } })
      expect(answer?.aiRationale).toBe('Correct answer')
    })

    it('does not award a partially correct MULTI_SELECT answer', async () => {
      const question = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'MULTI_SELECT',
          text: 'Which of these are falsy in JavaScript?',
          choices: ['0', '"0"', 'null', '[]'],
          correctIndexes: [0, 2],
          points: 10,
          order: 1,
        },
      })

      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          response: ['0'], // one of the two correct choices
        },
      })

      await assessmentQueue.add('grade-assessment', { attemptId: attempt.id })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      expect(completed.returnvalue.totalScore).toBe(0)

      const answer = await prisma.answer.findFirst({ where: { attemptId: attempt.id } })
      // Scored, not parked for manual review.
      expect(answer?.aiRationale).toContain('Incorrect')
      expect(answer?.aiRationale).not.toContain('Pending manual review')
    })

    it('should mark incorrect multiple choice answer as wrong', async () => {
      // Arrange
      const question = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'MCQ',
          text: 'What is the output of typeof null?',
          choices: ['null', 'undefined', 'object', 'number'],
          correctIndexes: [2],
          points: 10,
          order: 1,
        },
      })

      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          response: { answer: 'null' }, // Wrong answer
        },
      })

      await assessmentQueue.add('grade-assessment', {
        attemptId: attempt.id,
      })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act
      await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert
      const updatedAttempt = await prisma.attempt.findUnique({
        where: { id: attempt.id },
      })

      expect(updatedAttempt?.totalScore).toBe(0)
      expect(updatedAttempt?.percentage).toBe(0)

      const answer = await prisma.answer.findFirst({
        where: { attemptId: attempt.id },
      })

      expect(answer?.finalScore).toBe(0)
      expect(answer?.aiRationale).toContain('Incorrect')
    })
  })

  describe('Job Processing - Coding Questions', () => {
    it('should grade coding questions with Claude AI', async () => {
      // Arrange
      const question = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'CODE',
          text: 'Write a function to reverse a string',
          points: 20,
          order: 1,
        },
      })

      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          response: {
            answer: 'function reverseString(str) { return str.split("").reverse().join(""); }',
          },
        },
      })

      await assessmentQueue.add('grade-assessment', {
        attemptId: attempt.id,
      })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert
      expect(completed.returnvalue.success).toBe(true)

      const answer = await prisma.answer.findFirst({
        where: { attemptId: attempt.id },
      })

      // Mock returns 85% score (0.85 * 20 = 17)
      expect(answer?.aiScore).toBe(17)
      expect(answer?.aiRationale).toContain('Good solution')
    })

    it('should call Claude AI with correct parameters', async () => {
      // Arrange
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const mockCreate = vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              score: 90,
              feedback: 'Excellent implementation',
              passedTests: 5,
              totalTests: 5,
            }),
          },
        ],
      })

      vi.spyOn(Anthropic.prototype.messages, 'create').mockImplementation(mockCreate)

      const question = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'CODE',
          text: 'Write a function to check if a string is a palindrome',
          points: 15,
          order: 1,
        },
      })

      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          response: {
            answer: 'function isPalindrome(s) { return s === s.split("").reverse().join(""); }',
          },
        },
      })

      await assessmentQueue.add('grade-assessment', {
        attemptId: attempt.id,
      })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act
      await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert - Verify Claude was called
      expect(mockCreate).toHaveBeenCalled()
      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs.model).toBe('claude-opus-4-20250514')
      expect(callArgs.messages[0].content).toContain('isPalindrome')
    })
  })

  describe('Job Processing - Free Text Questions', () => {
    it('should mark free text questions for manual review', async () => {
      // Arrange
      const question = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'LONG_TEXT',
          text: 'Explain the event loop in JavaScript',
          points: 15,
          order: 1,
        },
      })

      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          response: {
            answer: 'The event loop is a mechanism that handles asynchronous operations...',
          },
        },
      })

      await assessmentQueue.add('grade-assessment', {
        attemptId: attempt.id,
      })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act
      await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert
      const answer = await prisma.answer.findFirst({
        where: { attemptId: attempt.id },
      })

      expect(answer?.finalScore).toBe(0)
      expect(answer?.aiRationale).toContain('manual review')
    })
  })

  describe('Mixed Question Types', () => {
    it('should correctly grade assessment with multiple question types', async () => {
      // Arrange
      const mcQuestion = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'MCQ',
          text: 'Which is a primitive type?',
          choices: ['Array', 'String', 'Object', 'Function'],
          correctIndexes: [1],
          points: 10,
          order: 1,
        },
      })

      const codingQuestion = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'CODE',
          text: 'Write a function to add two numbers',
          points: 20,
          order: 2,
        },
      })

      const freeTextQuestion = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'LONG_TEXT',
          text: 'Explain closures',
          points: 15,
          order: 3,
        },
      })

      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await prisma.answer.createMany({
        data: [
          {
            attemptId: attempt.id,
            questionId: mcQuestion.id,
            response: { answer: 'String' }, // Correct
          },
          {
            attemptId: attempt.id,
            questionId: codingQuestion.id,
            response: { answer: 'function add(a, b) { return a + b; }' },
          },
          {
            attemptId: attempt.id,
            questionId: freeTextQuestion.id,
            response: { answer: 'Closures allow functions to access variables...' },
          },
        ],
      })

      await assessmentQueue.add('grade-assessment', {
        attemptId: attempt.id,
      })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert
      expect(completed.returnvalue.success).toBe(true)
      expect(completed.returnvalue.maxScore).toBe(45) // 10 + 20 + 15

      // MC: 10 points, Coding: 17 points (85%), Free text: 0 (manual review)
      expect(completed.returnvalue.totalScore).toBe(27)
    })
  })

  describe('Email Notifications', () => {
    it('should send email notification after grading', async () => {
      // Arrange
      const { sendEmail } = await import('@/lib/email')

      const question = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'MCQ',
          text: 'Test question',
          choices: ['A', 'B', 'C', 'D'],
          correctIndexes: [0],
          points: 10,
          order: 1,
        },
      })

      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          response: { answer: 'A' },
        },
      })

      await assessmentQueue.add('grade-assessment', {
        attemptId: attempt.id,
      })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act
      await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert - Email should be sent
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test-candidate@example.com',
          subject: expect.stringContaining('Assessment Results'),
          html: expect.stringContaining('Jane Doe'),
        }),
      )
    })

    it('should include pass/fail status in email', async () => {
      // Arrange
      const { sendEmail } = await import('@/lib/email')
      vi.mocked(sendEmail).mockClear()

      const question = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'MCQ',
          text: 'Test question',
          choices: ['A', 'B'],
          correctIndexes: [0],
          points: 100,
          order: 1,
        },
      })

      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          response: { answer: 'B' }, // Wrong answer - 0%
        },
      })

      await assessmentQueue.add('grade-assessment', {
        attemptId: attempt.id,
      })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act
      await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert - Should show failed status (< 70%)
      expect(sendEmail).toHaveBeenCalled()
      const emailCall = vi.mocked(sendEmail).mock.calls[0][0]
      expect(emailCall.html).toContain('Did not pass')
    })
  })

  describe('Retry Logic', () => {
    it('should retry failed jobs with default backoff', async () => {
      // Arrange
      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      const job = await assessmentQueue.add(
        'grade-assessment',
        { attemptId: attempt.id },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      )

      // Assert
      expect(job.opts.attempts).toBe(3)
      expect(job.opts.backoff).toBeDefined()
    })

    it('should handle Claude API errors gracefully', async () => {
      // Arrange
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      vi.spyOn(Anthropic.prototype.messages, 'create').mockRejectedValue(
        new Error('Claude API error'),
      )

      const question = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'CODE',
          text: 'Test coding question',
          points: 20,
          order: 1,
        },
      })

      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          response: { answer: 'function test() {}' },
        },
      })

      await assessmentQueue.add('grade-assessment', { attemptId: attempt.id }, { attempts: 1 })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act - Worker should still complete (fallback to 0 score with manual review message)
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert - Job completes with fallback grading
      expect(completed).toBeDefined()

      const answer = await prisma.answer.findFirst({
        where: { attemptId: attempt.id },
      })

      expect(answer?.aiScore).toBe(0)
      expect(answer?.aiRationale).toContain('Failed to grade automatically')
    })
  })

  describe('Failure Handling', () => {
    it('should handle non-existent attempt', async () => {
      // Arrange
      const nonExistentId = 'non-existent-attempt-id'

      await assessmentQueue.add('grade-assessment', {
        attemptId: nonExistentId,
      })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act
      const failed = await new Promise<{ error: Error }>((resolve) => {
        worker.on('failed', (job, error) => {
          resolve({ error })
        })
      })

      // Assert
      expect(failed.error.message).toContain('Assessment attempt')
      expect(failed.error.message).toContain('not found')
    })

    it('should handle attempt with no answers', async () => {
      // Arrange - Attempt with no answers
      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await assessmentQueue.add('grade-assessment', {
        attemptId: attempt.id,
      })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert - Should complete with 0 score
      expect(completed.returnvalue.success).toBe(true)
      expect(completed.returnvalue.totalScore).toBe(0)
      expect(completed.returnvalue.maxScore).toBe(0)
      expect(completed.returnvalue.percentage).toBe(0)
    })

    it('should handle missing candidate email gracefully', async () => {
      // Arrange - Candidate without email
      const candidateNoEmail = await prisma.candidate.create({
        data: {
          orgId: TEST_IDS.org,
          source: 'MANUAL',
        },
      })

      const inviteNoEmail = await prisma.assessmentInvite.create({
        data: {
          assessmentId: assessment.id,
          candidateId: candidateNoEmail.id,
          token: 'test-invite-token-no-email',
          status: 'SENT',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })

      const attemptNoEmail = await prisma.attempt.create({
        data: {
          candidateId: candidateNoEmail.id,
          inviteId: inviteNoEmail.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      const question = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'MCQ',
          text: 'Test',
          choices: ['A', 'B'],
          correctIndexes: [0],
          points: 10,
          order: 1,
        },
      })

      await prisma.answer.create({
        data: {
          attemptId: attemptNoEmail.id,
          questionId: question.id,
          response: { answer: 'A' },
        },
      })

      await assessmentQueue.add('grade-assessment', {
        attemptId: attemptNoEmail.id,
      })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act - Should complete without sending email
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert
      expect(completed.returnvalue.success).toBe(true)

      // Cleanup
      await prisma.answer.deleteMany({ where: { attemptId: attemptNoEmail.id } })
      await prisma.attempt.delete({ where: { id: attemptNoEmail.id } })
      await prisma.assessmentInvite.delete({ where: { id: inviteNoEmail.id } })
      await prisma.candidate.delete({ where: { id: candidateNoEmail.id } })
    })
  })

  describe('Score Calculation', () => {
    it('should calculate percentage correctly', async () => {
      // Arrange
      const q1 = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'MCQ',
          text: 'Q1',
          choices: ['A', 'B'],
          correctIndexes: [0],
          points: 25,
          order: 1,
        },
      })

      const q2 = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'MCQ',
          text: 'Q2',
          choices: ['A', 'B'],
          correctIndexes: [1],
          points: 75,
          order: 2,
        },
      })

      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await prisma.answer.createMany({
        data: [
          {
            attemptId: attempt.id,
            questionId: q1.id,
            response: { answer: 'A' }, // Correct - 25 points
          },
          {
            attemptId: attempt.id,
            questionId: q2.id,
            response: { answer: 'A' }, // Wrong - 0 points
          },
        ],
      })

      await assessmentQueue.add('grade-assessment', {
        attemptId: attempt.id,
      })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert
      expect(completed.returnvalue.totalScore).toBe(25)
      expect(completed.returnvalue.maxScore).toBe(100)
      expect(completed.returnvalue.percentage).toBe(25)
    })

    it('should determine pass/fail based on 70% threshold', async () => {
      // Arrange
      const question = await prisma.question.create({
        data: {
          sectionId: section.id,
          type: 'MCQ',
          text: 'Test',
          choices: ['A', 'B'],
          correctIndexes: [0],
          points: 100,
          order: 1,
        },
      })

      attempt = await prisma.attempt.create({
        data: {
          candidateId: candidate.id,
          inviteId: invite.id,
          startedAt: new Date(),
          status: 'SUBMITTED',
        },
      })

      await prisma.answer.create({
        data: {
          attemptId: attempt.id,
          questionId: question.id,
          response: { answer: 'A' }, // 100%
        },
      })

      await assessmentQueue.add('grade-assessment', {
        attemptId: attempt.id,
      })

      worker = new Worker<AssessmentJobData>(
        'assessments-test',
        async (job: Job<AssessmentJobData>) => {
          const { processAssessmentGrading } = await import('@/workers/assessment-grading.worker')
          return processAssessmentGrading(job)
        },
        { connection },
      )

      // Act
      await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert
      const updatedAttempt = await prisma.attempt.findUnique({
        where: { id: attempt.id },
      })

      expect(updatedAttempt?.percentage).toBe(100)
      expect((updatedAttempt?.detail as any).passed).toBe(true)
    })
  })

  describe('Concurrency', () => {
    it('should respect worker concurrency settings', async () => {
      // Arrange
      const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5')

      const testWorker = new Worker<AssessmentJobData>(
        'assessments-concurrency-test',
        async (_job: Job<AssessmentJobData>) => {
          return { processed: true }
        },
        {
          connection,
          concurrency: WORKER_CONCURRENCY,
        },
      )

      // Assert
      expect(WORKER_CONCURRENCY).toBe(5)

      await testWorker.close()
    })
  })
})
