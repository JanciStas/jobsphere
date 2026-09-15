/**
 * Assessment Grading Worker
 * Automatically grades assessment attempts using Claude AI
 */

import { Worker, Job } from 'bullmq'
import { connection, AssessmentJobData } from '@/lib/queue'
import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'
import Anthropic from '@anthropic-ai/sdk'

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5')

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

/**
 * Grade a coding question using Claude
 */
async function gradeCodeWithClaude(
  prompt: string,
  answer: string,
  testCases: any[],
): Promise<{ score: number; feedback: string }> {
  const systemPrompt = `You are an expert programming instructor grading a coding challenge.

Evaluate the provided code against these criteria:
1. Correctness - Does it solve the problem?
2. Code quality - Is it readable and well-structured?
3. Efficiency - Is the solution optimal?
4. Test coverage - Does it pass all test cases?

Test Cases:
${JSON.stringify(testCases, null, 2)}

Return your evaluation in JSON format:
{
  "score": <0-100>,
  "feedback": "<detailed feedback>",
  "passedTests": <number of tests passed>,
  "totalTests": <total tests>
}`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Problem: ${prompt}\n\nCandidate's Solution:\n\`\`\`\n${answer}\n\`\`\`\n\nPlease evaluate this solution.`,
        },
      ],
    })

    const content = response.content[0]
    if (content.type === 'text') {
      const result = JSON.parse(content.text)
      return {
        score: result.score / 100, // Convert to 0-1 scale
        feedback: result.feedback,
      }
    }

    throw new Error('Unexpected response format')
  } catch (error) {
    logger.error('Claude grading failed', { error })
    return {
      score: 0,
      feedback: 'Failed to grade automatically. Manual review required.',
    }
  }
}

/**
 * Map stored question types to internal worker types.
 *
 * The keys on the left are the values that actually reach the database. The app
 * writes exactly five of them — MCQ, MULTI_SELECT, SHORT_TEXT, LONG_TEXT, CODE
 * (see schemas/assessment.schema.ts, the builder and the runner). This map used
 * to key on MULTI / SHORT / LONG / FILE, a vocabulary nothing produces, so
 * MULTI_SELECT fell through the `|| 'FREE_TEXT'` default below and every
 * multi-select answer was filed as "Pending manual review" worth zero points —
 * silently dragging the attempt percentage down and flipping passes into fails.
 * The legacy spellings are kept for rows written before the vocabulary settled.
 */
const questionTypeMap: Record<string, 'MULTIPLE_CHOICE' | 'MULTI_SELECT' | 'CODING' | 'FREE_TEXT'> =
  {
    MCQ: 'MULTIPLE_CHOICE',
    MULTI_SELECT: 'MULTI_SELECT',
    SHORT_TEXT: 'FREE_TEXT',
    LONG_TEXT: 'FREE_TEXT',
    CODE: 'CODING',
    // Legacy keys.
    MULTI: 'MULTI_SELECT',
    SHORT: 'FREE_TEXT',
    LONG: 'FREE_TEXT',
    FILE: 'FREE_TEXT',
  }

/**
 * Process assessment grading
 */
export async function processAssessmentGrading(job: Job<AssessmentJobData>) {
  const { attemptId } = job.data

  logger.info('Processing assessment grading', { attemptId, jobId: job.id })

  try {
    // 1. Get attempt with responses
    const attempt = await prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        invite: {
          include: {
            assessment: {
              select: { id: true, name: true, orgId: true, passingScore: true },
            },
          },
        },
        answers: {
          include: {
            question: true,
          },
        },
      },
    })

    if (!attempt) {
      throw new Error(`Assessment attempt ${attemptId} not found`)
    }

    let totalScore = 0
    let maxScore = 0
    const gradingDetails: any[] = []

    // 2. Grade each response
    for (const response of attempt.answers) {
      const question = response.question

      if (!question) {
        logger.warn('Question not found for response', { responseId: response.id })
        continue
      }

      const questionPoints = question.points || 1
      maxScore += questionPoints

      let earnedPoints = 0
      let feedback = ''

      // Grade based on question type
      // response.response is JSON, extract answer value
      const answerValue =
        typeof response.response === 'object' && response.response !== null
          ? (response.response as any).answer ||
            (response.response as any).value ||
            JSON.stringify(response.response)
          : String(response.response)

      // Map schema type to worker type
      const mappedType = questionTypeMap[question.type] || 'FREE_TEXT'

      switch (mappedType) {
        case 'MULTIPLE_CHOICE': {
          // Simple comparison - check if answer matches correct choice
          const correctChoice = question.choices[question.correctIndexes[0]]
          if (answerValue === correctChoice) {
            earnedPoints = questionPoints
            feedback = 'Correct answer'
          } else {
            feedback = `Incorrect. Correct answer: ${correctChoice}`
          }
          break
        }

        case 'MULTI_SELECT': {
          // The runner stores a MULTI_SELECT answer as an array of choice TEXTS,
          // so compare sets rather than a single index: all correct choices, and
          // nothing else, earns the points.
          const correctChoices = question.correctIndexes
            .map((i) => question.choices[i])
            .filter((choice): choice is string => typeof choice === 'string')

          const raw = response.response as unknown
          let selected: string[] = []
          if (Array.isArray(raw)) {
            selected = raw.map((v) => String(v))
          } else if (typeof answerValue === 'string' && answerValue.trim().startsWith('[')) {
            try {
              const parsed = JSON.parse(answerValue)
              if (Array.isArray(parsed)) selected = parsed.map((v) => String(v))
            } catch {
              selected = []
            }
          } else if (answerValue) {
            selected = [String(answerValue)]
          }

          const selectedSet = new Set(selected)
          const exact =
            correctChoices.length > 0 &&
            selectedSet.size === correctChoices.length &&
            correctChoices.every((choice) => selectedSet.has(choice))

          if (exact) {
            earnedPoints = questionPoints
            feedback = 'Correct answer'
          } else {
            feedback = `Incorrect. Correct answer: ${correctChoices.join(', ')}`
          }
          break
        }

        case 'CODING': {
          // Grade with Claude AI
          // Note: Question model doesn't have testCases field, using empty array
          const gradingResult = await gradeCodeWithClaude(question.text || '', answerValue, [])

          earnedPoints = gradingResult.score * questionPoints
          feedback = gradingResult.feedback
          break
        }

        case 'FREE_TEXT':
          // Store for manual review
          feedback = 'Pending manual review'
          earnedPoints = 0
          break

        default:
          feedback = 'Unknown question type'
      }

      totalScore += earnedPoints

      gradingDetails.push({
        questionId: question.id,
        questionTitle: question.text,
        earnedPoints,
        maxPoints: questionPoints,
        feedback,
      })

      // Update response with AI scoring
      // Note: feedback field doesn't exist on Answer model, stored in aiRationale instead
      await prisma.answer.update({
        where: { id: response.id },
        data: {
          aiScore: earnedPoints,
          aiRationale: feedback, // Store feedback in aiRationale field
          finalScore: earnedPoints,
        },
      })
    }

    // 3. Calculate final score
    const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0
    const passingThreshold = attempt.invite.assessment.passingScore ?? 70
    const passed = percentage >= passingThreshold

    // 4. Update attempt
    // Note: passed field doesn't exist on Attempt model, store in detail JSON field instead
    await prisma.attempt.update({
      where: { id: attemptId },
      data: {
        totalScore,
        percentage,
        status: 'GRADED',
        submittedAt: new Date(),
        detail: {
          // Preserve anything already stored on the attempt (e.g. anti-cheat
          // telemetry written at submit time) rather than clobbering it.
          ...(typeof attempt.detail === 'object' && attempt.detail !== null
            ? (attempt.detail as Record<string, unknown>)
            : {}),
          passed,
          percentage,
          maxScore,
        },
      },
    })

    logger.info('Assessment graded successfully', {
      attemptId,
      totalScore,
      maxScore,
      percentage,
    })

    // 5. Send notification email to candidate
    const candidate = await prisma.candidate.findUnique({
      where: { id: attempt.invite.candidateId },
      include: {
        contacts: {
          where: { isPrimary: true },
          take: 1,
        },
      },
    })

    const candidateEmail = candidate?.contacts?.[0]?.email
    if (candidateEmail) {
      const { sendEmail } = await import('@/lib/email')

      const candidateName = candidate.contacts?.[0]?.fullName || 'there'
      const assessmentTitle = attempt.invite.assessment.name

      await sendEmail({
        to: candidateEmail,
        subject: `Assessment Results - ${assessmentTitle}`,
        html: `
          <h2>Assessment Completed</h2>
          <p>Hi ${candidateName},</p>
          <p>Your assessment <strong>${assessmentTitle}</strong> has been graded.</p>

          <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3>Your Results</h3>
            <p><strong>Score:</strong> ${totalScore.toFixed(1)} / ${maxScore}</p>
            <p><strong>Percentage:</strong> ${percentage.toFixed(1)}%</p>
            <p><strong>Status:</strong> ${passed ? '✅ Passed' : '❌ Did not pass'}</p>
          </div>

          ${
            passed
              ? '<p>Congratulations! You have successfully passed this assessment.</p>'
              : `<p>Unfortunately, you did not meet the passing threshold of ${passingThreshold}%. You may be able to retake this assessment.</p>`
          }

          <hr />
          <p style="color: #666; font-size: 12px;">JobSphere ATS - Modern recruitment platform</p>
        `,
      })

      logger.info('Assessment results email sent', { attemptId, email: candidateEmail })
    }

    return { success: true, totalScore, maxScore, percentage }
  } catch (error) {
    logger.error('Failed to grade assessment', {
      error,
      attemptId,
      jobId: job.id,
    })
    throw error
  }
}

/**
 * Create and start the worker.
 *
 * Constructed on demand — see the note on createEmailSequenceWorker.
 */
export function createAssessmentGradingWorker() {
  const worker = new Worker<AssessmentJobData>('assessments', processAssessmentGrading, {
    connection,
    concurrency: WORKER_CONCURRENCY,
  })

  worker.on('completed', (job) => {
    logger.info('Assessment grading job completed', { jobId: job.id })
  })

  worker.on('failed', (job, error) => {
    logger.error('Assessment grading job failed', {
      jobId: job?.id,
      error,
      data: job?.data,
    })
  })

  worker.on('error', (error) => {
    logger.error('Assessment grading worker error', { error })
  })

  logger.info('Assessment grading worker started', { concurrency: WORKER_CONCURRENCY })
  return worker
}
