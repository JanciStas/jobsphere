import { describe, it, expect } from 'vitest'
import { getPrismaClient, TEST_IDS, createTestJob, createTestCandidate } from '../helpers/test-db'

/**
 * Vector Search Integration Tests
 * Tests pgvector similarity search for semantic job-candidate matching
 */

const prisma = getPrismaClient()

describe('Vector Search (pgvector)', () => {
  // Seeding, per-test cleanup and teardown are all handled globally in
  // tests/integration/setup.ts. This file used to repeat them, and its afterAll
  // called cleanupAllTestData() + disconnectDb() — deleting the shared fixture
  // organisation and closing the client while other files were still using them.
  // With fileParallelism now off that is no longer destructive, but duplicating
  // the lifecycle here would still disconnect the client mid-run for every file
  // scheduled after this one.

  describe('Vector Storage', () => {
    it('should store job embedding as vector', async () => {
      // Create a mock embedding (1536 dimensions for OpenAI embeddings)
      const embedding = Array.from({ length: 1536 }, () => Math.random())

      // $executeRaw returns an affected-row count, not the row — the assertions
      // below read the job back with a separate query.
      await prisma.$executeRaw`
        INSERT INTO "Job" (
          id, "orgId", title, description, "createdBy", locale, status,
          "employmentType", seniority, "salaryMin", "salaryMax", "salaryCurrency",
          remote, hybrid, embedding, "updatedAt"
        )
        VALUES (
          'test-job-vector-1',
          ${TEST_IDS.org},
          'Senior React Developer',
          ${'A great job opportunity for a skilled React developer with 5+ years experience. ' + 'A'.repeat(50)},
          ${TEST_IDS.recruiter},
          'en',
          'PUBLISHED',
          'FULL_TIME',
          'SENIOR',
          70000,
          100000,
          'EUR',
          true,
          false,
          ${`[${embedding.join(',')}]`}::vector, NOW()
        )
      `

      // Retrieve and verify
      const retrieved = await prisma.$queryRaw<Array<{ id: string; title: string }>>`
        SELECT id, title
        FROM "Job"
        WHERE id = 'test-job-vector-1'
      `

      expect(retrieved).toHaveLength(1)
      expect(retrieved[0].title).toBe('Senior React Developer')
    })

    it('should store resume section embedding as vector', async () => {
      const candidate = await createTestCandidate()

      const resume = await prisma.resume.create({
        data: {
          candidateId: candidate.id,
          language: 'en',
          skills: ['JavaScript', 'React', 'Node.js'],
        },
      })

      // 1536, not 768: the HNSW migration pinned "embeddingVector" to
      // vector(1536) (pgvector refuses to index a dimensionless column), so a
      // 768-wide vector is rejected with "expected 1536 dimensions, not 768".
      const embedding = Array.from({ length: 1536 }, () => Math.random())

      await prisma.$executeRaw`
        INSERT INTO "ResumeSection" (
          id, "resumeId", kind, title, organization, text, "order", "embeddingVector", "embeddingModel"
        )
        VALUES (
          'test-section-vector-1',
          ${resume.id},
          'EXPERIENCE',
          'Senior Software Engineer',
          'Tech Corp',
          'Built scalable React applications with TypeScript',
          1,
          ${`[${embedding.join(',')}]`}::vector,
          'text-embedding-ada-002'
        )
      `

      const retrieved = await prisma.$queryRaw<Array<{ id: string; title: string }>>`
        SELECT id, title
        FROM "ResumeSection"
        WHERE id = 'test-section-vector-1'
      `

      expect(retrieved).toHaveLength(1)
      expect(retrieved[0].title).toBe('Senior Software Engineer')
    })

    it('should handle null embeddings', async () => {
      const job = await createTestJob({ title: 'Job Without Embedding' })

      // Embedding should be null by default
      // embedding is Unsupported("vector(1536)"); Prisma cannot deserialize it
      // straight out of $queryRaw, so read it as text — null stays null.
      const retrieved = await prisma.$queryRaw<Array<{ id: string; embedding: string | null }>>`
        SELECT id, embedding::text AS embedding
        FROM "Job"
        WHERE id = ${job.id}
      `

      expect(retrieved).toHaveLength(1)
      expect(retrieved[0].embedding).toBeNull()
    })
  })

  describe('Cosine Similarity Search', () => {
    it('should find similar jobs using cosine similarity', async () => {
      // Create base embedding for "React Developer"
      const baseEmbedding = Array.from({ length: 1536 }, () => Math.random())

      // Create similar embedding (small perturbation)
      const similarEmbedding = baseEmbedding.map((val) => val + (Math.random() - 0.5) * 0.1)

      // Create dissimilar embedding.
      //
      // This used to be another Math.random() vector, and the "< 0.5" assertion
      // below could never hold: every component of Math.random() is positive, so
      // two such vectors both sit in the positive orthant and their expected
      // cosine similarity is E[xy] / E[x^2] = 0.25 / (1/3) = 0.75, regardless of
      // dimension. The measured value was 0.751 — the maths, not a flaky search.
      // Centring on zero gives a genuinely unrelated direction (expected cosine
      // ~0), which is what "dissimilar" was meant to mean.
      const dissimilarEmbedding = Array.from({ length: 1536 }, () => Math.random() - 0.5)

      // Insert jobs with embeddings
      await prisma.$executeRaw`
        INSERT INTO "Job" (
          id, "orgId", title, description, "createdBy", locale, status,
          "employmentType", seniority, "salaryMin", "salaryMax", "salaryCurrency",
          remote, hybrid, embedding, "updatedAt"
        )
        VALUES
          (
            'job-react-1',
            ${TEST_IDS.org},
            'React Developer',
            ${'React developer position. ' + 'A'.repeat(50)},
            ${TEST_IDS.recruiter},
            'en',
            'PUBLISHED',
            'FULL_TIME',
            'MID',
            50000,
            80000,
            'EUR',
            false,
            false,
            ${`[${baseEmbedding.join(',')}]`}::vector, NOW()
          ),
          (
            'job-react-2',
            ${TEST_IDS.org},
            'Senior React Engineer',
            ${'Senior React position. ' + 'A'.repeat(50)},
            ${TEST_IDS.recruiter},
            'en',
            'PUBLISHED',
            'FULL_TIME',
            'SENIOR',
            70000,
            100000,
            'EUR',
            false,
            false,
            ${`[${similarEmbedding.join(',')}]`}::vector, NOW()
          ),
          (
            'job-python-1',
            ${TEST_IDS.org},
            'Python Backend Developer',
            ${'Python backend position. ' + 'A'.repeat(50)},
            ${TEST_IDS.recruiter},
            'en',
            'PUBLISHED',
            'FULL_TIME',
            'MID',
            55000,
            85000,
            'EUR',
            false,
            false,
            ${`[${dissimilarEmbedding.join(',')}]`}::vector, NOW()
          )
      `

      // Search for jobs similar to baseEmbedding using cosine similarity
      const results = await prisma.$queryRaw<
        Array<{ id: string; title: string; similarity: number }>
      >`
        SELECT
          id,
          title,
          1 - (embedding <=> ${`[${baseEmbedding.join(',')}]`}::vector) as similarity
        FROM "Job"
        WHERE "orgId" = ${TEST_IDS.org}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${`[${baseEmbedding.join(',')}]`}::vector
        LIMIT 3
      `

      expect(results).toHaveLength(3)

      // First result should be exact match
      expect(results[0].id).toBe('job-react-1')
      expect(results[0].similarity).toBeGreaterThan(0.99)

      // Second result should be similar React job
      expect(results[1].id).toBe('job-react-2')
      expect(results[1].similarity).toBeGreaterThan(0.9)

      // Third result should be dissimilar Python job
      expect(results[2].id).toBe('job-python-1')
      expect(results[2].similarity).toBeLessThan(0.5)
      // Ranking, not just the absolute number: the unrelated job must score
      // strictly below the related one.
      expect(results[2].similarity).toBeLessThan(results[1].similarity)
    })

    it('should calculate distance between embeddings', async () => {
      const embedding1 = Array.from({ length: 1536 }, () => Math.random())
      const embedding2 = Array.from({ length: 1536 }, () => Math.random())

      await prisma.$executeRaw`
        INSERT INTO "Job" (
          id, "orgId", title, description, "createdBy", locale, status,
          "employmentType", seniority, "salaryMin", "salaryMax", "salaryCurrency",
          remote, hybrid, embedding, "updatedAt"
        )
        VALUES
          (
            'job-distance-1',
            ${TEST_IDS.org},
            'Job 1',
            ${'Job 1 description. ' + 'A'.repeat(50)},
            ${TEST_IDS.recruiter},
            'en',
            'PUBLISHED',
            'FULL_TIME',
            'MID',
            50000,
            80000,
            'EUR',
            false,
            false,
            ${`[${embedding1.join(',')}]`}::vector, NOW()
          ),
          (
            'job-distance-2',
            ${TEST_IDS.org},
            'Job 2',
            ${'Job 2 description. ' + 'A'.repeat(50)},
            ${TEST_IDS.recruiter},
            'en',
            'PUBLISHED',
            'FULL_TIME',
            'MID',
            50000,
            80000,
            'EUR',
            false,
            false,
            ${`[${embedding2.join(',')}]`}::vector, NOW()
          )
      `

      // Calculate cosine distance between jobs
      const result = await prisma.$queryRaw<Array<{ distance: number }>>`
        SELECT
          (
            SELECT embedding
            FROM "Job"
            WHERE id = 'job-distance-1'
          ) <=> (
            SELECT embedding
            FROM "Job"
            WHERE id = 'job-distance-2'
          ) as distance
      `

      expect(result).toHaveLength(1)
      expect(result[0].distance).toBeGreaterThan(0)
      expect(result[0].distance).toBeLessThanOrEqual(2) // Cosine distance is in [0, 2]
    })
  })

  describe('L2 Distance (Euclidean)', () => {
    it('should search using L2 distance', async () => {
      const queryEmbedding = Array.from({ length: 1536 }, () => Math.random())

      await prisma.$executeRaw`
        INSERT INTO "Job" (
          id, "orgId", title, description, "createdBy", locale, status,
          "employmentType", seniority, "salaryMin", "salaryMax", "salaryCurrency",
          remote, hybrid, embedding, "updatedAt"
        )
        VALUES
          (
            'job-l2-1',
            ${TEST_IDS.org},
            'Frontend Developer',
            ${'Frontend position. ' + 'A'.repeat(50)},
            ${TEST_IDS.recruiter},
            'en',
            'PUBLISHED',
            'FULL_TIME',
            'MID',
            50000,
            80000,
            'EUR',
            false,
            false,
            ${`[${queryEmbedding.join(',')}]`}::vector, NOW()
          )
      `

      const results = await prisma.$queryRaw<Array<{ id: string; l2_distance: number }>>`
        SELECT
          id,
          embedding <-> ${`[${queryEmbedding.join(',')}]`}::vector as l2_distance
        FROM "Job"
        WHERE id = 'job-l2-1'
      `

      expect(results).toHaveLength(1)
      expect(results[0].l2_distance).toBeCloseTo(0, 2) // Same embedding should have ~0 distance
    })
  })

  describe('Inner Product', () => {
    it('should search using inner product (negative)', async () => {
      const queryEmbedding = Array.from({ length: 1536 }, () => Math.random())

      await prisma.$executeRaw`
        INSERT INTO "Job" (
          id, "orgId", title, description, "createdBy", locale, status,
          "employmentType", seniority, "salaryMin", "salaryMax", "salaryCurrency",
          remote, hybrid, embedding, "updatedAt"
        )
        VALUES
          (
            'job-inner-1',
            ${TEST_IDS.org},
            'Data Scientist',
            ${'Data science position. ' + 'A'.repeat(50)},
            ${TEST_IDS.recruiter},
            'en',
            'PUBLISHED',
            'FULL_TIME',
            'SENIOR',
            60000,
            90000,
            'EUR',
            false,
            false,
            ${`[${queryEmbedding.join(',')}]`}::vector, NOW()
          )
      `

      const results = await prisma.$queryRaw<Array<{ id: string; inner_product: number }>>`
        SELECT
          id,
          embedding <#> ${`[${queryEmbedding.join(',')}]`}::vector as inner_product
        FROM "Job"
        WHERE id = 'job-inner-1'
      `

      expect(results).toHaveLength(1)
      expect(results[0].inner_product).toBeLessThan(0) // Negative inner product
    })
  })

  describe('Hybrid Search', () => {
    it('should combine vector similarity with filters', async () => {
      const embedding1 = Array.from({ length: 1536 }, () => Math.random())
      const embedding2 = embedding1.map((val) => val + (Math.random() - 0.5) * 0.1)
      const embedding3 = Array.from({ length: 1536 }, () => Math.random())

      await prisma.$executeRaw`
        INSERT INTO "Job" (
          id, "orgId", title, description, "createdBy", locale, status,
          "employmentType", seniority, "salaryMin", "salaryMax", "salaryCurrency",
          remote, hybrid, embedding, "updatedAt"
        )
        VALUES
          (
            'job-hybrid-1',
            ${TEST_IDS.org},
            'Senior JavaScript Developer',
            ${'Senior JS position. ' + 'A'.repeat(50)},
            ${TEST_IDS.recruiter},
            'en',
            'PUBLISHED',
            'FULL_TIME',
            'SENIOR',
            70000,
            100000,
            'EUR',
            true,
            false,
            ${`[${embedding1.join(',')}]`}::vector, NOW()
          ),
          (
            'job-hybrid-2',
            ${TEST_IDS.org},
            'Mid JavaScript Developer',
            ${'Mid JS position. ' + 'A'.repeat(50)},
            ${TEST_IDS.recruiter},
            'en',
            'PUBLISHED',
            'FULL_TIME',
            'MID',
            50000,
            70000,
            'EUR',
            true,
            false,
            ${`[${embedding2.join(',')}]`}::vector, NOW()
          ),
          (
            'job-hybrid-3',
            ${TEST_IDS.org},
            'Senior Python Developer',
            ${'Senior Python position. ' + 'A'.repeat(50)},
            ${TEST_IDS.recruiter},
            'en',
            'PUBLISHED',
            'FULL_TIME',
            'SENIOR',
            75000,
            105000,
            'EUR',
            false,
            false,
            ${`[${embedding3.join(',')}]`}::vector, NOW()
          )
      `

      // Search for SENIOR + REMOTE jobs similar to embedding1
      const results = await prisma.$queryRaw<
        Array<{ id: string; title: string; similarity: number }>
      >`
        SELECT
          id,
          title,
          1 - (embedding <=> ${`[${embedding1.join(',')}]`}::vector) as similarity
        FROM "Job"
        WHERE "orgId" = ${TEST_IDS.org}
          AND seniority = 'SENIOR'
          AND remote = true
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${`[${embedding1.join(',')}]`}::vector
        LIMIT 5
      `

      // Should only return job-hybrid-1 (SENIOR + REMOTE)
      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('job-hybrid-1')
      expect(results[0].similarity).toBeGreaterThan(0.99)
    })

    it('should combine vector search with salary range filter', async () => {
      const embedding = Array.from({ length: 1536 }, () => Math.random())

      await prisma.$executeRaw`
        INSERT INTO "Job" (
          id, "orgId", title, description, "createdBy", locale, status,
          "employmentType", seniority, "salaryMin", "salaryMax", "salaryCurrency",
          remote, hybrid, embedding, "updatedAt"
        )
        VALUES
          (
            'job-salary-1',
            ${TEST_IDS.org},
            'High Paying Job',
            ${'High salary position. ' + 'A'.repeat(50)},
            ${TEST_IDS.recruiter},
            'en',
            'PUBLISHED',
            'FULL_TIME',
            'SENIOR',
            90000,
            120000,
            'EUR',
            false,
            false,
            ${`[${embedding.join(',')}]`}::vector, NOW()
          ),
          (
            'job-salary-2',
            ${TEST_IDS.org},
            'Medium Paying Job',
            ${'Medium salary position. ' + 'A'.repeat(50)},
            ${TEST_IDS.recruiter},
            'en',
            'PUBLISHED',
            'FULL_TIME',
            'MID',
            50000,
            70000,
            'EUR',
            false,
            false,
            ${`[${embedding.join(',')}]`}::vector, NOW()
          )
      `

      // Search for jobs with salary >= 80000
      const results = await prisma.$queryRaw<
        Array<{ id: string; title: string; salaryMin: number }>
      >`
        SELECT
          id,
          title,
          "salaryMin"
        FROM "Job"
        WHERE "orgId" = ${TEST_IDS.org}
          AND "salaryMin" >= 80000
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${`[${embedding.join(',')}]`}::vector
      `

      expect(results).toHaveLength(1)
      expect(results[0].id).toBe('job-salary-1')
      expect(results[0].salaryMin).toBe(90000)
    })
  })

  describe('Performance and Indexing', () => {
    it('should efficiently search through multiple embeddings', async () => {
      const queryEmbedding = Array.from({ length: 1536 }, () => Math.random())

      // Insert multiple jobs
      const insertPromises = []
      for (let i = 0; i < 10; i++) {
        const embedding = Array.from({ length: 1536 }, () => Math.random())
        insertPromises.push(
          prisma.$executeRaw`
            INSERT INTO "Job" (
              id, "orgId", title, description, "createdBy", locale, status,
              "employmentType", seniority, "salaryMin", "salaryMax", "salaryCurrency",
              remote, hybrid, embedding, "updatedAt"
            )
            VALUES (
              ${'job-perf-' + i},
              ${TEST_IDS.org},
              ${'Job ' + i},
              ${'Job description ' + i + '. ' + 'A'.repeat(50)},
              ${TEST_IDS.recruiter},
              'en',
              'PUBLISHED',
              'FULL_TIME',
              'MID',
              50000,
              80000,
              'EUR',
              false,
              false,
              ${`[${embedding.join(',')}]`}::vector, NOW()
            )
          `,
        )
      }
      await Promise.all(insertPromises)

      const startTime = Date.now()

      const results = await prisma.$queryRaw<Array<{ id: string; similarity: number }>>`
        SELECT
          id,
          1 - (embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector) as similarity
        FROM "Job"
        WHERE "orgId" = ${TEST_IDS.org}
          AND embedding IS NOT NULL
        ORDER BY embedding <=> ${`[${queryEmbedding.join(',')}]`}::vector
        LIMIT 5
      `

      const endTime = Date.now()
      const queryTime = endTime - startTime

      expect(results).toHaveLength(5)
      expect(queryTime).toBeLessThan(1000) // Should complete in less than 1 second

      // Verify results are ordered by similarity
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity)
      }
    })
  })

  describe('Match Score with Vector Search', () => {
    it('should store and retrieve match scores with vector similarity', async () => {
      const job = await createTestJob()
      const candidate = await createTestCandidate()

      const matchScore = await prisma.matchScore.create({
        data: {
          orgId: TEST_IDS.org,
          jobId: job.id,
          candidateId: candidate.id,
          score0to100: 85,
          bm25Score: 0.75,
          vectorScore: 0.88, // Vector similarity score
          llmScore: 0.82,
          evidence: {
            skills: ['JavaScript', 'React', 'TypeScript'],
            experience: ['5 years web development'],
          },
          explanation: ['Strong match on technical skills', 'Relevant experience in similar role'],
          version: 'v1.0',
        },
      })

      expect(matchScore.vectorScore).toBe(0.88)

      // Query match scores ordered by vector score
      const topMatches = await prisma.matchScore.findMany({
        where: {
          jobId: job.id,
          vectorScore: { not: null },
        },
        orderBy: {
          vectorScore: 'desc',
        },
        take: 10,
      })

      expect(topMatches).toHaveLength(1)
      expect(topMatches[0].id).toBe(matchScore.id)
    })
  })
})
