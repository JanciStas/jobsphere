/**
 * Embeddings Library
 * Generate and manage vector embeddings for CV and job semantic search
 *
 * MULTI-PROVIDER SUPPORT:
 * Configure via EMBEDDING_PROVIDER env var (default: 'openai')
 * Supported: 'openai', 'voyage', 'cohere'
 *
 * To add a new provider:
 * 1. Install provider SDK (e.g., npm install voyage-ai)
 * 2. Add API key to env.ts
 * 3. Create provider-specific client and embedding function
 * 4. Update generateEmbedding() to dispatch based on EMBEDDING_PROVIDER
 *
 * Current implementation: OpenAI (default)
 */

import OpenAI from 'openai'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

let openai: OpenAI | null = null

function getOpenAI(): OpenAI {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }
  return openai
}

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = parseInt(process.env.OPENAI_EMBEDDING_DIMENSIONS || '1536')

/**
 * pgvector accepts its literal as '[a,b,c]'. Prisma has no vector type, so the
 * value has to reach the database as text and be cast in SQL.
 */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Generate embeddings for a single text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty')
    }

    // Truncate text to fit within token limits (~8000 tokens)
    const truncatedText = text.slice(0, 32000)

    const response = await getOpenAI().embeddings.create({
      model: EMBEDDING_MODEL,
      input: truncatedText,
      dimensions: EMBEDDING_DIMENSIONS,
    })

    return response.data[0].embedding
  } catch (error) {
    logger.error('Failed to generate embedding', { error, textLength: text.length })
    throw new Error('Failed to generate embedding')
  }
}

/**
 * Generate embeddings for multiple texts in batch
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  try {
    if (texts.length === 0) {
      return []
    }

    // OpenAI allows up to 2048 inputs per batch
    const MAX_BATCH_SIZE = 100
    const batches: number[][][] = []

    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batch = texts.slice(i, i + MAX_BATCH_SIZE)
      const truncatedBatch = batch.map((t) => t.slice(0, 32000))

      const response = await getOpenAI().embeddings.create({
        model: EMBEDDING_MODEL,
        input: truncatedBatch,
        dimensions: EMBEDDING_DIMENSIONS,
      })

      batches.push(response.data.map((d) => d.embedding))
    }

    return batches.flat()
  } catch (error) {
    logger.error('Failed to generate batch embeddings', { error, count: texts.length })
    throw new Error('Failed to generate batch embeddings')
  }
}

/**
 * Generate embeddings for all sections of a resume
 */
export async function generateCVEmbeddings(resumeId: string): Promise<void> {
  try {
    const sections = await prisma.resumeSection.findMany({
      where: { resumeId },
      orderBy: { order: 'asc' },
    })

    if (sections.length === 0) {
      logger.warn('No resume sections found', { resumeId })
      return
    }

    for (const section of sections) {
      // ResumeSection has title and text fields
      const sectionText = [section.title, section.text].filter(Boolean).join('\n')

      if (!sectionText || sectionText.trim().length === 0) {
        continue
      }

      try {
        const embedding = await generateEmbedding(sectionText)

        // Raw UPDATE, not prisma.resumeSection.update(). `embeddingVector` is
        // Unsupported("vector"), so Prisma rejects it as an unknown argument at
        // RUNTIME — the @ts-expect-error that used to sit here silenced the
        // compiler but not the query engine. The throw landed in the per-section
        // catch below, which logs and continues, so CV embeddings were never
        // written and semantic CV search had nothing to match on. pgvector also
        // needs the ::vector cast that the client cannot produce.
        await prisma.$executeRaw`
          UPDATE "ResumeSection"
          SET "embeddingVector" = ${toVectorLiteral(embedding)}::vector,
              "embeddingModel" = ${EMBEDDING_MODEL}
          WHERE id = ${section.id}
        `

        logger.info('Generated embedding for resume section', {
          resumeId,
          sectionId: section.id,
          kind: section.kind,
        })
      } catch (error) {
        logger.error('Failed to generate section embedding', {
          error,
          resumeId,
          sectionId: section.id,
        })
        // Continue with other sections even if one fails
      }
    }

    logger.info('Completed CV embeddings generation', {
      resumeId,
      sectionsProcessed: sections.length,
    })
  } catch (error) {
    logger.error('Failed to generate CV embeddings', { error, resumeId })
    throw new Error('Failed to generate CV embeddings')
  }
}

/**
 * Generate embedding for a job description
 */
export async function generateJobEmbedding(jobId: string): Promise<void> {
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        title: true,
        description: true,
        city: true,
      },
    })

    if (!job) {
      throw new Error('Job not found')
    }

    // Combine all job text fields
    const jobText = [job.title, job.description, job.city].filter(Boolean).join('\n\n')

    if (jobText.trim().length === 0) {
      logger.warn('Job has no text content', { jobId })
      return
    }

    const embedding = await generateEmbedding(jobText)

    // Same reason as generateCVEmbeddings: Job.embedding is
    // Unsupported("vector(1536)") and prisma.job.update() throws on it at
    // runtime, so no job embedding was ever persisted and semantic job search
    // matched nothing.
    await prisma.$executeRaw`
      UPDATE "Job"
      SET embedding = ${toVectorLiteral(embedding)}::vector,
          "updatedAt" = NOW()
      WHERE id = ${jobId}
    `

    logger.info('Generated job embedding', { jobId })
  } catch (error) {
    logger.error('Failed to generate job embedding', { error, jobId })
    throw new Error('Failed to generate job embedding')
  }
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error('Embeddings must have same dimensions')
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}
