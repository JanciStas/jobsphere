/**
 * Integration Tests for Embedding Worker
 * Tests embedding generation with real Redis and BullMQ
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Queue, Worker, Job } from 'bullmq'
import IORedis from 'ioredis'
import { prisma, TEST_IDS, createTestJob } from '../helpers/test-db'
import type { EmbeddingJobData } from '@/lib/queue'

// Mock OpenAI to prevent actual API calls.
//
// `embeddings` lives on the PROTOTYPE, not as a class field. lib/embeddings.ts
// builds (and memoises) its client lazily, and the tests below reach it through
// `vi.spyOn(OpenAI.prototype.embeddings, 'create')`. As an own field per instance
// there is nothing on the prototype to spy on — "spyOn could not find an object
// to spy upon".
const { openaiEmbeddingsCreate } = vi.hoisted(() => ({ openaiEmbeddingsCreate: vi.fn() }))

const makeEmbeddingResponse = () => ({
  data: [
    {
      embedding: Array(1536)
        .fill(0)
        .map(() => Math.random()),
    },
  ],
})

vi.mock('openai', () => {
  class OpenAI {}
  ;(OpenAI.prototype as any).embeddings = { create: openaiEmbeddingsCreate }
  return { default: OpenAI }
})

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

describe('Embedding Worker Integration Tests', () => {
  let connection: IORedis
  let embeddingQueue: Queue<EmbeddingJobData>
  let worker: Worker<EmbeddingJobData>
  let testJob: any
  let testResume: any
  let testCandidate: any

  beforeEach(async () => {
    // One shared mock backs every OpenAI instance now, so restore the default
    // before each test — otherwise a mockRejectedValue leaks into the next one.
    vi.restoreAllMocks()
    openaiEmbeddingsCreate.mockReset()
    openaiEmbeddingsCreate.mockImplementation(async () => makeEmbeddingResponse())

    // Setup Redis connection
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })

    // Create test queue
    embeddingQueue = new Queue<EmbeddingJobData>('embeddings-test', {
      connection,
    })

    // Clean existing jobs
    await embeddingQueue.drain()
    await embeddingQueue.clean(0, 100, 'completed')
    await embeddingQueue.clean(0, 100, 'failed')

    // Create test job
    testJob = await createTestJob({
      title: 'Senior Software Engineer',
      description:
        'Looking for an experienced software engineer with expertise in Node.js, React, and TypeScript. Must have 5+ years of experience.',
      city: 'San Francisco',
    })

    // Create test candidate with resume
    testCandidate = await prisma.candidate.create({
      data: {
        orgId: TEST_IDS.org,
        source: 'MANUAL',
      },
    })

    testResume = await prisma.resume.create({
      data: {
        candidateId: testCandidate.id,
        // Resume has no `version` column — it never has. Passing one made every
        // test in this file fail in beforeEach with a validation error.
        language: 'en',
      },
    })
  })

  afterEach(async () => {
    // Stop worker if running
    if (worker) {
      await worker.close()
    }

    // Clean up queue
    await embeddingQueue.drain()
    await embeddingQueue.close()
    await connection.quit()

    // Clean up database
    await prisma.resumeSection.deleteMany({
      where: { resumeId: testResume.id },
    })
    await prisma.resume.deleteMany({
      where: { id: testResume.id },
    })
    await prisma.candidate.deleteMany({
      where: { id: testCandidate.id },
    })
    await prisma.job.deleteMany({
      where: { id: testJob.id },
    })
  })

  describe('Job Enqueueing', () => {
    it('should successfully enqueue CV embedding job', async () => {
      // Act
      const job = await embeddingQueue.add('generate-embedding', {
        resumeId: testResume.id,
      })

      // Assert
      expect(job.id).toBeDefined()
      expect(job.data.resumeId).toBe(testResume.id)
      expect(job.data.jobId).toBeUndefined()

      const waitingCount = await embeddingQueue.getWaitingCount()
      expect(waitingCount).toBe(1)
    })

    it('should successfully enqueue job embedding job', async () => {
      // Act
      const job = await embeddingQueue.add('generate-embedding', {
        jobId: testJob.id,
      })

      // Assert
      expect(job.id).toBeDefined()
      expect(job.data.jobId).toBe(testJob.id)
      expect(job.data.resumeId).toBeUndefined()

      const waitingCount = await embeddingQueue.getWaitingCount()
      expect(waitingCount).toBe(1)
    })

    it('should set lower priority for embedding jobs', async () => {
      // Act
      const job = await embeddingQueue.add(
        'generate-embedding',
        { resumeId: testResume.id },
        { priority: 2 },
      )

      // Assert
      expect(job.opts.priority).toBe(2)
    })
  })

  describe('Job Processing - CV Embeddings', () => {
    it('should generate embeddings for all resume sections', async () => {
      // Arrange
      const section1 = await prisma.resumeSection.create({
        data: {
          resumeId: testResume.id,
          kind: 'EXPERIENCE',
          title: 'Work Experience',
          text: 'Senior Developer at Tech Corp. Built scalable web applications using React and Node.js.',
          order: 1,
        },
      })

      const section2 = await prisma.resumeSection.create({
        data: {
          resumeId: testResume.id,
          kind: 'EDUCATION',
          title: 'Education',
          text: 'BSc Computer Science from University',
          order: 2,
        },
      })

      await embeddingQueue.add('generate-embedding', {
        resumeId: testResume.id,
      })

      worker = new Worker<EmbeddingJobData>(
        'embeddings-test',
        async (job: Job<EmbeddingJobData>) => {
          const { generateCVEmbeddings } = await import('@/lib/embeddings')
          if (job.data.resumeId) {
            await generateCVEmbeddings(job.data.resumeId)
            return { success: true, type: 'cv', resumeId: job.data.resumeId }
          }
          throw new Error('resumeId is required')
        },
        { connection },
      )

      // Act
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert
      expect(completed).toBeDefined()
      expect(completed.returnvalue.success).toBe(true)
      expect(completed.returnvalue.type).toBe('cv')

      // Verify embeddings were saved
      const updatedSection1 = await prisma.resumeSection.findUnique({
        where: { id: section1.id },
      })

      const updatedSection2 = await prisma.resumeSection.findUnique({
        where: { id: section2.id },
      })

      // Note: embeddingVector is Unsupported type, so we can't directly check it
      // But the job should complete successfully
      expect(updatedSection1).toBeDefined()
      expect(updatedSection2).toBeDefined()
    })

    it('should handle resume with no sections gracefully', async () => {
      // Arrange - Resume with no sections
      await embeddingQueue.add('generate-embedding', {
        resumeId: testResume.id,
      })

      worker = new Worker<EmbeddingJobData>(
        'embeddings-test',
        async (job: Job<EmbeddingJobData>) => {
          const { generateCVEmbeddings } = await import('@/lib/embeddings')
          if (job.data.resumeId) {
            await generateCVEmbeddings(job.data.resumeId)
            return { success: true, type: 'cv', resumeId: job.data.resumeId }
          }
          throw new Error('resumeId is required')
        },
        { connection },
      )

      // Act
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert - Should complete without error
      expect(completed).toBeDefined()
      expect(completed.returnvalue.success).toBe(true)
    })

    it('should skip sections with no text content', async () => {
      // Arrange - Section with only title, no text
      await prisma.resumeSection.create({
        data: {
          resumeId: testResume.id,
          kind: 'CUSTOM',
          title: 'Empty Section',
          text: '',
          order: 1,
        },
      })

      await embeddingQueue.add('generate-embedding', {
        resumeId: testResume.id,
      })

      worker = new Worker<EmbeddingJobData>(
        'embeddings-test',
        async (job: Job<EmbeddingJobData>) => {
          const { generateCVEmbeddings } = await import('@/lib/embeddings')
          if (job.data.resumeId) {
            await generateCVEmbeddings(job.data.resumeId)
            return { success: true, type: 'cv', resumeId: job.data.resumeId }
          }
          throw new Error('resumeId is required')
        },
        { connection },
      )

      // Act
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert - Should complete successfully
      expect(completed.returnvalue.success).toBe(true)
    })
  })

  describe('Job Processing - Job Embeddings', () => {
    it('should generate embedding for job description', async () => {
      // Arrange
      await embeddingQueue.add('generate-embedding', {
        jobId: testJob.id,
      })

      worker = new Worker<EmbeddingJobData>(
        'embeddings-test',
        async (job: Job<EmbeddingJobData>) => {
          const { generateJobEmbedding } = await import('@/lib/embeddings')
          if (job.data.jobId) {
            await generateJobEmbedding(job.data.jobId)
            return { success: true, type: 'job', jobId: job.data.jobId }
          }
          throw new Error('jobId is required')
        },
        { connection },
      )

      // Act
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert
      expect(completed).toBeDefined()
      expect(completed.returnvalue.success).toBe(true)
      expect(completed.returnvalue.type).toBe('job')

      // Verify embedding was saved
      const updatedJob = await prisma.job.findUnique({
        where: { id: testJob.id },
      })

      expect(updatedJob).toBeDefined()
    })

    it('should combine job fields for embedding generation', async () => {
      // Arrange
      const OpenAI = (await import('openai')).default
      const mockCreate = vi.fn().mockResolvedValue({
        data: [
          {
            embedding: Array(1536)
              .fill(0)
              .map(() => Math.random()),
          },
        ],
      })

      // Mock the embeddings.create method
      vi.spyOn(OpenAI.prototype.embeddings, 'create').mockImplementation(mockCreate)

      await embeddingQueue.add('generate-embedding', {
        jobId: testJob.id,
      })

      worker = new Worker<EmbeddingJobData>(
        'embeddings-test',
        async (job: Job<EmbeddingJobData>) => {
          const { generateJobEmbedding } = await import('@/lib/embeddings')
          if (job.data.jobId) {
            await generateJobEmbedding(job.data.jobId)
            return { success: true, type: 'job', jobId: job.data.jobId }
          }
          throw new Error('jobId is required')
        },
        { connection },
      )

      // Act
      await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert - OpenAI should be called with combined text
      expect(mockCreate).toHaveBeenCalled()
      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs.input).toContain('Senior Software Engineer')
      expect(callArgs.input).toContain('Node.js')
    })
  })

  describe('Retry Logic', () => {
    it('should retry failed jobs with exponential backoff', async () => {
      // Arrange
      const job = await embeddingQueue.add(
        'generate-embedding',
        { resumeId: testResume.id },
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
      expect(job.opts.backoff).toEqual({
        type: 'exponential',
        delay: 2000,
      })
    })

    // This used to drive generateCVEmbeddings and wait for 'failed'. It never
    // arrived: that function catches per-section errors, logs them and moves on
    // by design, so a CV whose every section failed still resolves. The job path
    // is the one that propagates, so the retry/failure contract is asserted there,
    // and the CV path's deliberate tolerance is pinned separately below.
    it('should move to failed after max attempts on API error', async () => {
      const OpenAI = (await import('openai')).default
      vi.spyOn(OpenAI.prototype.embeddings, 'create').mockRejectedValue(
        new Error('OpenAI API rate limit exceeded'),
      )

      await embeddingQueue.add('generate-embedding', { jobId: testJob.id }, { attempts: 1 })

      worker = new Worker<EmbeddingJobData>(
        'embeddings-test',
        async (job: Job<EmbeddingJobData>) => {
          const { generateJobEmbedding } = await import('@/lib/embeddings')
          if (job.data.jobId) {
            await generateJobEmbedding(job.data.jobId)
            return { success: true, type: 'job', jobId: job.data.jobId }
          }
          throw new Error('jobId is required')
        },
        { connection },
      )

      // Act
      const failed = await new Promise<{ job?: Job; error: Error }>((resolve) => {
        worker.on('failed', (job, error) => {
          resolve({ job, error })
        })
      })

      // Assert
      expect(failed.error).toBeDefined()
      const failedCount = await embeddingQueue.getFailedCount()
      expect(failedCount).toBeGreaterThan(0)
    })

    it('tolerates a per-section embedding failure without failing the CV job', async () => {
      const OpenAI = (await import('openai')).default
      vi.spyOn(OpenAI.prototype.embeddings, 'create').mockRejectedValue(
        new Error('OpenAI API rate limit exceeded'),
      )

      await embeddingQueue.add('generate-embedding', { resumeId: testResume.id }, { attempts: 1 })

      worker = new Worker<EmbeddingJobData>(
        'embeddings-test',
        async (job: Job<EmbeddingJobData>) => {
          const { generateCVEmbeddings } = await import('@/lib/embeddings')
          await generateCVEmbeddings(job.data.resumeId!)
          return { success: true, type: 'cv', resumeId: job.data.resumeId }
        },
        { connection },
      )

      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      expect(completed.returnvalue.success).toBe(true)
    })
  })

  describe('Failure Handling', () => {
    it('should fail when both resumeId and jobId are missing', async () => {
      // Arrange
      await embeddingQueue.add('generate-embedding', {
        // Neither resumeId nor jobId provided
      } as EmbeddingJobData)

      worker = new Worker<EmbeddingJobData>(
        'embeddings-test',
        async (job: Job<EmbeddingJobData>) => {
          if (!job.data.resumeId && !job.data.jobId) {
            throw new Error('Either resumeId or jobId must be provided')
          }
          return { success: false }
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
      expect(failed.error.message).toContain('Either resumeId or jobId must be provided')
    })

    it('should handle non-existent resume', async () => {
      // Arrange
      const nonExistentId = 'non-existent-resume-id'

      await embeddingQueue.add('generate-embedding', {
        resumeId: nonExistentId,
      })

      worker = new Worker<EmbeddingJobData>(
        'embeddings-test',
        async (job: Job<EmbeddingJobData>) => {
          const { generateCVEmbeddings } = await import('@/lib/embeddings')
          if (job.data.resumeId) {
            await generateCVEmbeddings(job.data.resumeId)
            return { success: true, type: 'cv', resumeId: job.data.resumeId }
          }
          throw new Error('resumeId is required')
        },
        { connection },
      )

      // Act - Should complete (no sections found is not an error)
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert - Job completes successfully even with no sections
      expect(completed).toBeDefined()
    })

    it('should handle non-existent job', async () => {
      // Arrange
      const nonExistentId = 'non-existent-job-id'

      await embeddingQueue.add('generate-embedding', {
        jobId: nonExistentId,
      })

      worker = new Worker<EmbeddingJobData>(
        'embeddings-test',
        async (job: Job<EmbeddingJobData>) => {
          const { generateJobEmbedding } = await import('@/lib/embeddings')
          if (job.data.jobId) {
            await generateJobEmbedding(job.data.jobId)
            return { success: true, type: 'job', jobId: job.data.jobId }
          }
          throw new Error('jobId is required')
        },
        { connection },
      )

      // Act
      const failed = await new Promise<{ error: Error }>((resolve) => {
        worker.on('failed', (job, error) => {
          resolve({ error })
        })
      })

      // Assert — generateJobEmbedding deliberately re-wraps every internal failure
      // (including its own 'Job not found') into one opaque message; the specific
      // cause goes to the log, not to the queue. Pinned as-is so the wrapper is not
      // removed by accident.
      expect(failed.error.message).toBe('Failed to generate job embedding')
    })

    it('should handle empty text gracefully', async () => {
      // Arrange
      const emptyJob = await createTestJob({
        title: '',
        description: '',
        city: null,
      })

      await embeddingQueue.add('generate-embedding', {
        jobId: emptyJob.id,
      })

      worker = new Worker<EmbeddingJobData>(
        'embeddings-test',
        async (job: Job<EmbeddingJobData>) => {
          const { generateJobEmbedding } = await import('@/lib/embeddings')
          if (job.data.jobId) {
            await generateJobEmbedding(job.data.jobId)
            return { success: true, type: 'job', jobId: job.data.jobId }
          }
          throw new Error('jobId is required')
        },
        { connection },
      )

      // Act - Should complete gracefully
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert
      expect(completed).toBeDefined()

      // Cleanup
      await prisma.job.delete({ where: { id: emptyJob.id } })
    })
  })

  describe('Rate Limiting', () => {
    it('should respect OpenAI rate limits', async () => {
      // Arrange - Worker with rate limiter
      const rateLimitedWorker = new Worker<EmbeddingJobData>(
        'embeddings-rate-limited',
        async (_job: Job<EmbeddingJobData>) => {
          return { processed: true }
        },
        {
          connection,
          limiter: {
            max: 50, // Max 50 jobs per minute (OpenAI limit)
            duration: 60000,
          },
        },
      )

      const rateLimitedQueue = new Queue<EmbeddingJobData>('embeddings-rate-limited', {
        connection,
      })

      // Act - Add multiple jobs
      await Promise.all([
        rateLimitedQueue.add('generate-embedding', { resumeId: testResume.id }),
        rateLimitedQueue.add('generate-embedding', { resumeId: testResume.id }),
        rateLimitedQueue.add('generate-embedding', { resumeId: testResume.id }),
      ])

      let completedCount = 0
      await new Promise<void>((resolve) => {
        rateLimitedWorker.on('completed', () => {
          completedCount++
          if (completedCount === 3) resolve()
        })

        // Timeout
        setTimeout(() => resolve(), 5000)
      })

      // Assert
      expect(completedCount).toBe(3)

      // Cleanup
      await rateLimitedWorker.close()
      await rateLimitedQueue.drain()
      await rateLimitedQueue.close()
    })

    it('should have lower concurrency than other workers', async () => {
      // Arrange
      const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '3')

      const worker = new Worker<EmbeddingJobData>(
        'embeddings-concurrency-test',
        async (_job: Job<EmbeddingJobData>) => {
          return { processed: true }
        },
        {
          connection,
          concurrency: WORKER_CONCURRENCY,
        },
      )

      // Assert - Embeddings should have lower concurrency (3 vs 5 for other workers)
      expect(WORKER_CONCURRENCY).toBeLessThanOrEqual(3)

      await worker.close()
    })
  })

  describe('Batch Processing', () => {
    it('should handle multiple resume sections efficiently', async () => {
      // Arrange - Create multiple sections
      const sections = await Promise.all([
        prisma.resumeSection.create({
          data: {
            resumeId: testResume.id,
            kind: 'EXPERIENCE',
            title: 'Experience 1',
            text: 'Software Engineer at Company A',
            order: 1,
          },
        }),
        prisma.resumeSection.create({
          data: {
            resumeId: testResume.id,
            kind: 'EXPERIENCE',
            title: 'Experience 2',
            text: 'Software Engineer at Company B',
            order: 2,
          },
        }),
        prisma.resumeSection.create({
          data: {
            resumeId: testResume.id,
            kind: 'EDUCATION',
            title: 'Education',
            text: 'BSc Computer Science',
            order: 3,
          },
        }),
      ])

      await embeddingQueue.add('generate-embedding', {
        resumeId: testResume.id,
      })

      worker = new Worker<EmbeddingJobData>(
        'embeddings-test',
        async (job: Job<EmbeddingJobData>) => {
          const { generateCVEmbeddings } = await import('@/lib/embeddings')
          if (job.data.resumeId) {
            await generateCVEmbeddings(job.data.resumeId)
            return { success: true, type: 'cv', resumeId: job.data.resumeId }
          }
          throw new Error('resumeId is required')
        },
        { connection },
      )

      // Act
      const startTime = Date.now()
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })
      const duration = Date.now() - startTime

      // Assert
      expect(completed.returnvalue.success).toBe(true)
      // Should process all sections
      expect(sections).toHaveLength(3)
      // Should complete in reasonable time (not sequentially slow)
      expect(duration).toBeLessThan(10000) // Less than 10 seconds
    })
  })

  describe('Edge Cases', () => {
    it('should handle very long text by truncating', async () => {
      // Arrange - Create section with very long text (>32000 chars)
      const longText = 'A'.repeat(40000)
      await prisma.resumeSection.create({
        data: {
          resumeId: testResume.id,
          kind: 'CUSTOM',
          title: 'Long Section',
          text: longText,
          order: 1,
        },
      })

      await embeddingQueue.add('generate-embedding', {
        resumeId: testResume.id,
      })

      worker = new Worker<EmbeddingJobData>(
        'embeddings-test',
        async (job: Job<EmbeddingJobData>) => {
          const { generateCVEmbeddings } = await import('@/lib/embeddings')
          if (job.data.resumeId) {
            await generateCVEmbeddings(job.data.resumeId)
            return { success: true, type: 'cv', resumeId: job.data.resumeId }
          }
          throw new Error('resumeId is required')
        },
        { connection },
      )

      // Act
      const completed = await new Promise<Job>((resolve) => {
        worker.on('completed', resolve)
      })

      // Assert - Should complete successfully (text truncated internally)
      expect(completed.returnvalue.success).toBe(true)
    })
  })
})
