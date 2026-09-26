import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPrismaClient, TEST_IDS, createTestCandidate } from '../helpers/test-db'
import { searchCandidates } from '@/lib/semantic-search'
import { stubEmbedding } from '@/lib/embeddings'

/**
 * searchCandidates() runs raw SQL against Resume / ResumeSection. Its unit tests
 * mock $queryRaw, so a query naming columns that do not exist (Resume.title,
 * ResumeSection.description) passed every test while the candidate-search page
 * returned a 500 in production. This runs the real query against the real schema.
 */

const prisma = getPrismaClient()
const JOB_TEXT = 'Senior React developer with TypeScript experience'

let previousStub: string | undefined
let previousEnv: string | undefined

beforeAll(() => {
  previousStub = process.env.E2E_STUB_EMBEDDINGS
  previousEnv = process.env.VERCEL_ENV
  process.env.E2E_STUB_EMBEDDINGS = '1'
  delete process.env.VERCEL_ENV
})

afterAll(() => {
  if (previousStub === undefined) delete process.env.E2E_STUB_EMBEDDINGS
  else process.env.E2E_STUB_EMBEDDINGS = previousStub
  if (previousEnv !== undefined) process.env.VERCEL_ENV = previousEnv
})

describe('searchCandidates against the real schema', () => {
  it('returns a candidate whose CV section embeds the same text', async () => {
    const candidate = await createTestCandidate()
    const resume = await prisma.resume.create({
      data: { candidateId: candidate.id, language: 'en', summary: 'React engineer, 8 years' },
    })
    const vector = `[${stubEmbedding(JOB_TEXT).join(',')}]`
    await prisma.$executeRaw`
      INSERT INTO "ResumeSection" (id, "resumeId", kind, title, text, "order", "embeddingVector")
      VALUES ('sem-search-1', ${resume.id}, 'EXPERIENCE', 'Senior React Engineer',
              'Built React and TypeScript applications', 1, ${vector}::vector)
    `

    const matches = await searchCandidates({
      jobDescription: JOB_TEXT,
      organizationId: TEST_IDS.org,
      limit: 5,
      minSimilarity: 0.9,
    })

    expect(matches).toHaveLength(1)
    expect(matches[0].candidateId).toBe(candidate.id)
    expect(matches[0].resumeId).toBe(resume.id)
    expect(matches[0].resumeTitle).toBe('React engineer, 8 years')
    expect(matches[0].similarity).toBeGreaterThan(0.99)
    expect(matches[0].matchedSection.content).toContain('React and TypeScript')
  })

  it('returns nothing (not an error) when no section is similar enough', async () => {
    const matches = await searchCandidates({
      jobDescription: JOB_TEXT,
      organizationId: TEST_IDS.org,
      limit: 5,
      minSimilarity: 1,
    })

    expect(matches).toEqual([])
  })

  it('stays inside the requested organisation', async () => {
    const matches = await searchCandidates({
      jobDescription: JOB_TEXT,
      organizationId: 'some-other-organisation',
      limit: 5,
      minSimilarity: 0,
    })

    expect(matches).toEqual([])
  })
})
