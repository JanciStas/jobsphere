/**
 * Semantic Search Library
 * Vector similarity search for candidates using pgvector
 */

import { prisma } from '@/lib/prisma'
import { generateEmbedding } from '@/lib/embeddings'
import { logger } from '@/lib/logger'
// Timeout profile lives in lib/transaction-options.ts so its relationship with
// the database's statement_timeout is documented in one place.
import { VECTOR_TX_OPTIONS } from '@/lib/transaction-options'

export interface CandidateMatch {
  candidateId: string
  resumeId: string
  resumeTitle: string
  similarity: number
  matchedSection?: {
    type: string
    content: string
  }
  candidate?: {
    id: string
    orgId: string
    tags: string[]
    source: string | null
  }
}

export interface SearchCandidatesParams {
  jobDescription: string
  organizationId?: string
  limit?: number
  minSimilarity?: number
  includeDetails?: boolean
}

/**
 * Search candidates using semantic similarity
 * @param params Search parameters
 * @returns Array of candidate matches sorted by similarity
 */
export async function searchCandidates(params: SearchCandidatesParams): Promise<CandidateMatch[]> {
  const {
    jobDescription,
    organizationId,
    limit = 10,
    minSimilarity = 0.5,
    includeDetails = false,
  } = params

  // SECURITY (multi-tenant): the search MUST be scoped to one organization.
  // Without an orgId filter the vector query returns ResumeSections from EVERY
  // tenant — including job-seekers' private CVs in the personal sentinel org.
  // Fail closed rather than leak across tenants.
  if (!organizationId) {
    throw new Error('searchCandidates requires organizationId for tenant isolation')
  }

  try {
    // 1. Generate embedding for job description
    logger.info('Generating job description embedding')
    const jobEmbedding = await generateEmbedding(jobDescription)

    // 2. Convert embedding to pgvector format
    const embeddingString = `[${jobEmbedding.join(',')}]`

    // 2.5 + 3. Set the HNSW search-quality parameter and run the vector search on
    // the SAME connection, inside one interactive transaction.
    //
    // Why the transaction is load-bearing: Prisma gives no connection affinity
    // between two separate `prisma.$…` calls, so a standalone
    // `SET hnsw.ef_search = 100` frequently lands on a different pooled connection
    // than the query that is supposed to benefit from it — and because plain `SET`
    // is session-scoped it then leaks to every unrelated query that later borrows
    // that connection. `SET LOCAL` inside `$transaction` binds the setting to this
    // one transaction on this one connection and is rolled back on commit.
    //
    // ef_search = 100 provides 95-98% recall (recommended for production).
    // See: apps/web/src/lib/VECTOR_SEARCH_PERFORMANCE.md
    // (VECTOR_TX_OPTIONS explains why the transaction timeout is raised.)
    const results = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL hnsw.ef_search = 100`
      return tx.$queryRaw<any[]>`
        SELECT
          r.id as "resumeId",
          LEFT(COALESCE(r.summary, ''), 120) as "resumeTitle",
          r."candidateId" as "candidateId",
          rs.kind as "sectionType",
          COALESCE(rs.text, rs.title, '') as "sectionContent",
          1 - (rs."embeddingVector" <=> ${embeddingString}::vector) as similarity
        FROM "ResumeSection" rs
        JOIN "Resume" r ON rs."resumeId" = r.id
        JOIN "Candidate" c ON r."candidateId" = c.id
        WHERE
          rs."embeddingVector" IS NOT NULL
          AND c."orgId" = ${organizationId}
          AND c."deletedAt" IS NULL
          AND r."deletedAt" IS NULL
          AND (1 - (rs."embeddingVector" <=> ${embeddingString}::vector)) >= ${minSimilarity}
        ORDER BY rs."embeddingVector" <=> ${embeddingString}::vector ASC
        LIMIT ${limit}
      `
    }, VECTOR_TX_OPTIONS)

    // 4. Transform results
    const matches: CandidateMatch[] = results.map((row) => ({
      candidateId: row.candidateId,
      resumeId: row.resumeId,
      resumeTitle: row.resumeTitle,
      similarity: parseFloat(row.similarity),
      matchedSection: {
        type: row.sectionType,
        content: row.sectionContent?.slice(0, 200) + '...',
      },
    }))

    // 5. Optionally include candidate details
    if (includeDetails && matches.length > 0) {
      const candidateIds = matches.map((m) => m.candidateId)
      const candidates = await prisma.candidate.findMany({
        where: { id: { in: candidateIds } },
        select: {
          id: true,
          orgId: true,
          tags: true,
          source: true,
        },
      })

      const candidateMap = new Map(candidates.map((c) => [c.id, c]))

      matches.forEach((match) => {
        match.candidate = candidateMap.get(match.candidateId)
      })
    }

    logger.info('Candidate search completed', {
      resultsCount: matches.length,
      limit,
      minSimilarity,
    })

    return matches
  } catch (error) {
    logger.error('Semantic candidate search failed', { error })
    throw new Error('Failed to search candidates')
  }
}

/**
 * Find similar candidates based on an existing candidate's CV
 * @param candidateId Source candidate ID
 * @param limit Number of similar candidates to return
 * @returns Array of similar candidate matches
 */
export async function findSimilarCandidates(
  candidateId: string,
  limit: number = 5,
): Promise<CandidateMatch[]> {
  try {
    const resume = await prisma.resume.findFirst({
      where: { candidateId },
      include: {
        candidate: { select: { orgId: true } },
        sections: {
          // @ts-expect-error embeddingVector is a Prisma `Unsupported` (pgvector) column, absent from the generated where-input type
          where: { embeddingVector: { not: null } },
          take: 1,
        },
      },
    })

    // @ts-expect-error - sections is included but TS doesn't infer it
    if (!resume || !resume.sections || resume.sections.length === 0) {
      logger.warn('No resume with embeddings found', { candidateId })
      return []
    }

    // @ts-expect-error - sections is included
    const sourceEmbedding = resume.sections[0].embeddingVector
    const embeddingString = `[${sourceEmbedding}]`
    // @ts-expect-error - candidate is included
    const orgId: string = resume.candidate.orgId

    // Set the HNSW search-quality parameter on the SAME connection as the query
    // (see the long note in searchCandidates above: a bare `SET` outside a
    // transaction lands on an arbitrary pooled connection and leaks session state).
    // Scope to the source candidate's own organization (multi-tenant isolation).
    const results = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL hnsw.ef_search = 100`
      return tx.$queryRaw<any[]>`
        SELECT
          r.id as "resumeId",
          LEFT(COALESCE(r.summary, ''), 120) as "resumeTitle",
          r."candidateId" as "candidateId",
          1 - (rs."embeddingVector" <=> ${embeddingString}::vector) as similarity
        FROM "ResumeSection" rs
        JOIN "Resume" r ON rs."resumeId" = r.id
        JOIN "Candidate" c ON r."candidateId" = c.id
        WHERE
          rs."embeddingVector" IS NOT NULL
          AND c."orgId" = ${orgId}
          AND c."deletedAt" IS NULL
          AND r."candidateId" != ${candidateId}
        ORDER BY rs."embeddingVector" <=> ${embeddingString}::vector ASC
        LIMIT ${limit}
      `
    }, VECTOR_TX_OPTIONS)

    return results.map((row) => ({
      candidateId: row.candidateId,
      resumeId: row.resumeId,
      resumeTitle: row.resumeTitle,
      similarity: parseFloat(row.similarity),
    }))
  } catch (error) {
    logger.error('Find similar candidates failed', { error, candidateId })
    throw new Error('Failed to find similar candidates')
  }
}

/**
 * Get match score between a specific job and candidate
 * @param jobId Job ID
 * @param candidateId Candidate ID
 * @returns Match score between 0-1
 */
export async function getJobCandidateMatchScore(
  jobId: string,
  candidateId: string,
): Promise<number | null> {
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      // @ts-expect-error embedding is a Prisma `Unsupported` (pgvector) column, absent from the generated select type
      select: { embedding: true },
    })

    // @ts-expect-error embedding is a Prisma `Unsupported` (pgvector) column, absent from the generated result type
    if (!job || !job.embedding) {
      logger.warn('Job has no embedding', { jobId })
      return null
    }

    const resume = await prisma.resume.findFirst({
      where: { candidateId },
      include: {
        sections: {
          where: {
            kind: 'SUMMARY',
            // @ts-expect-error embeddingVector is a Prisma `Unsupported` (pgvector) column, absent from the generated where-input type
            embeddingVector: { not: null },
          },
          take: 1,
        },
      },
    })

    // @ts-expect-error - sections is included but TS doesn't infer it
    if (!resume || !resume.sections || resume.sections.length === 0) {
      logger.warn('Candidate has no resume embedding', { candidateId })
      return null
    }

    // @ts-expect-error embedding is a Prisma `Unsupported` (pgvector) column, absent from the generated result type
    const jobEmbeddingString = `[${job.embedding}]`
    // @ts-expect-error - sections is included
    const cvEmbedding = resume.sections[0].embeddingVector
    const cvEmbeddingString = `[${cvEmbedding}]`

    const result = await prisma.$queryRaw<{ similarity: number }[]>`
      SELECT 1 - (${cvEmbeddingString}::vector <=> ${jobEmbeddingString}::vector) as similarity
    `

    return result[0]?.similarity || null
  } catch (error) {
    logger.error('Get match score failed', { error, jobId, candidateId })
    return null
  }
}
