/**
 * Assessment Creation API
 * Creates new assessments with sections and questions
 */

/* eslint-disable */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { errorResponse } from '@/lib/errors'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'
import { requireAuth } from '@/lib/auth'
import { createAssessmentSchema } from '@/schemas/assessment.schema'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'

/**
 * GET /api/assessments
 * Lists the current user's organization assessments (id + name only).
 * Used by the job-creation screening picker (PR5). Strictly org-scoped so a
 * caller can never enumerate another organization's tests.
 */
export const GET = withRateLimit<NextRequest>(
  async (_req: NextRequest) => {
    try {
      logger.apiRequest('GET', '/api/assessments')

      const session = await requireAuth()
      if (!session.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const userOrg = await prisma.userOrgRole.findFirst({
        where: { userId: session.user.id },
        select: { orgId: true },
      })

      if (!userOrg) {
        return NextResponse.json({ assessments: [] })
      }

      const assessments = await prisma.assessment.findMany({
        where: { orgId: userOrg.orgId },
        select: { id: true, name: true, isPublished: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      })

      return NextResponse.json({ assessments })
    } catch (error) {
      logger.apiError('GET', '/api/assessments', error)
      const errorData = errorResponse(error)
      return NextResponse.json({ error: errorData.error }, { status: errorData.statusCode })
    }
  },
  { preset: 'api' },
)

export const POST = withCsrfProtection<NextRequest>(
  withRateLimit<NextRequest>(
    async (req: NextRequest) => {
      const startTime = Date.now()
      try {
        logger.apiRequest('POST', '/api/assessments')

        // Authenticate
        const session = await requireAuth()

        if (!session.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get user's organization
        const userOrg = await prisma.userOrgRole.findFirst({
          where: { userId: session.user.id },
          select: {
            orgId: true,
            role: true,
            organization: {
              select: { name: true },
            },
          },
        })

        if (!userOrg) {
          return NextResponse.json(
            { error: 'You must belong to an organization to create assessments' },
            { status: 403 },
          )
        }

        // Verify user has permission to create assessments
        const allowedRoles = ['ORG_ADMIN', 'RECRUITER', 'HIRING_MANAGER']
        if (!allowedRoles.includes(userOrg.role)) {
          return NextResponse.json(
            {
              error:
                'Insufficient permissions. Only administrators, recruiters, and hiring managers can create assessments.',
            },
            { status: 403 },
          )
        }

        // Parse and validate request body
        const body = await req.json()
        const validated = createAssessmentSchema.parse(body)

        // Merge randomize into settings
        const settings = {
          ...(validated.settings || {}),
          randomize: validated.randomize,
        }

        // Create assessment with nested sections and questions
        type AssessmentWithSections = Prisma.AssessmentGetPayload<{
          include: {
            sections: {
              include: { questions: true }
            }
          }
        }>

        const assessment: AssessmentWithSections = await prisma.assessment.create({
          data: {
            orgId: userOrg.orgId,
            createdBy: session.user.id,
            name: validated.name,
            description: validated.description,
            locale: validated.locale,
            durationMin: validated.durationMin,
            passingScore: validated.passingScore,
            settings: settings,
            isPublished: false, // Default to unpublished until reviewed
            sections: {
              create: validated.sections.map((section, sectionIdx) => ({
                title: section.title,
                description: section.description,
                order: section.order ?? sectionIdx,
                questions: {
                  create: section.questions.map((question, questionIdx) => ({
                    type: question.type,
                    text: question.text,
                    choices: question.choices || [],
                    correctIndexes: question.correctIndexes || [],
                    // The schema field is starterCode; passing `code` made Prisma reject
                    // every assessment that contained a coding question (500).
                    starterCode: question.code,
                    language: question.language,
                    skillTag: question.skillTag,
                    points: question.points,
                    rubric: question.rubric,
                    order: question.order ?? questionIdx,
                  })),
                },
              })),
            },
          },
          include: {
            sections: {
              include: {
                questions: true,
              },
              orderBy: { order: 'asc' },
            },
          },
        })

        const duration = Date.now() - startTime
        const sectionsCount = assessment.sections.length
        const totalQuestions = assessment.sections.reduce(
          (sum: number, s) => sum + s.questions.length,
          0,
        )

        logger.info('Assessment created successfully', {
          assessmentId: assessment.id,
          orgId: userOrg.orgId,
          orgName: userOrg.organization.name,
          userId: session.user.id,
          sectionsCount,
          totalQuestions,
          duration,
        })

        return NextResponse.json(
          {
            success: true,
            assessment,
          },
          { status: 201 },
        )
      } catch (error) {
        if (error instanceof z.ZodError) {
          logger.apiError('POST', '/api/assessments', error)
          return NextResponse.json(
            {
              error: 'Validation failed',
              issues: error.issues,
            },
            { status: 400 },
          )
        }

        logger.apiError('POST', '/api/assessments', error)
        const errorData = errorResponse(error)
        return NextResponse.json({ error: errorData.error }, { status: errorData.statusCode })
      }
    },
    { preset: 'api', byUser: true }, // 100 requests per minute per user
  ),
)
