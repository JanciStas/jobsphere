/**
 * Application Service
 * Centralized business logic for job application management
 */

import { prisma } from '@/lib/prisma'
import { Prisma, PrismaClient } from '@prisma/client'
import { logger } from '@/lib/logger'
import { createAuditLog } from '@/lib/audit-log'
import { checkEntitlement, consumeEntitlement } from '@/lib/entitlements'
import { AppError } from '@/lib/errors'
import { ApplicationStage } from '@/lib/constants/application-stages'

export interface CreateApplicationInput {
  jobId: string
  candidateId: string
  orgId: string
  cvUrl?: string
  coverLetter?: string
  phone?: string
  email: string
  firstName: string
  lastName: string
  metadata?: Record<string, unknown>
}

export interface UpdateApplicationInput {
  stage?: ApplicationStage
  notes?: string
  tags?: string[]
}

export interface ApplicationSearchParams {
  jobId?: string
  candidateId?: string
  stage?: ApplicationStage
  status?: ApplicationStage // alias for stage
  search?: string
  limit?: number
  offset?: number
}

export class ApplicationService {
  /**
   * Create a new application
   */
  static async createApplication(input: CreateApplicationInput) {
    // Check if already applied
    const existingApplication = await prisma.application.findFirst({
      where: {
        jobId: input.jobId,
        candidateId: input.candidateId,
      },
    })

    if (existingApplication) {
      throw new AppError('You have already applied for this position', 400)
    }

    // Get job details
    const job = await prisma.job.findUnique({
      where: { id: input.jobId },
      include: { organization: true },
    })

    if (!job) {
      throw new AppError('Job not found', 404)
    }

    if (job.status !== 'PUBLISHED') {
      throw new AppError('This position is no longer accepting applications', 400)
    }

    // Check organization's candidate limit
    const canAddCandidate = await checkEntitlement(job.orgId, 'MAX_CANDIDATES')

    if (!canAddCandidate) {
      throw new AppError('Candidate limit reached for this organization', 403)
    }

    const application = await prisma.$transaction(async (tx) => {
      // Create application
      const newApplication = await tx.application.create({
        data: {
          jobId: input.jobId,
          candidateId: input.candidateId,
          orgId: input.orgId,
          stage: 'NEW',
          coverLetter: input.coverLetter || '',
        },
        include: {
          job: true,
          candidate: {
            include: {
              contacts: true,
            },
          },
        },
      })

      // Consume entitlement
      await consumeEntitlement(job.orgId, 'MAX_CANDIDATES', 1, tx as unknown as PrismaClient)

      // Create audit log
      await createAuditLog({
        userId: 'SYSTEM',
        orgId: job.orgId,
        action: 'CREATE',
        resource: 'APPLICATION',
        resourceId: newApplication.id,
        metadata: {
          jobId: input.jobId,
          candidateName: `${input.firstName} ${input.lastName}`,
        },
      })

      return newApplication
    })

    // Send notification email to recruiter (async)
    this.sendNewApplicationNotification(application).catch((err) =>
      logger.error('Async operation failed', err),
    )

    return application
  }

  /**
   * Update application status
   */
  static async updateApplicationStatus(
    applicationId: string,
    input: { status?: string; notes?: string; tags?: string[] },
    userId: string,
  ) {
    // Only `job.orgId` is read below (for the audit log) — select it rather than
    // pulling every Job column (description, requirements, JSON blobs, …).
    const existingApplication = await prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true, job: { select: { orgId: true } } },
    })

    if (!existingApplication) {
      throw new AppError('Application not found', 404)
    }

    const updatedApplication = await prisma.$transaction(async (tx: any) => {
      const application = await tx.application.update({
        where: { id: applicationId },
        data: {
          ...(input.status && { stage: input.status }),
          ...(input.notes !== undefined && { notes: input.notes }),
        },
      })

      await createAuditLog({
        userId,
        orgId: (existingApplication as any).job.orgId,
        action: 'UPDATE',
        resource: 'APPLICATION',
        resourceId: applicationId,
        metadata: input as Prisma.InputJsonValue,
      })

      return {
        ...application,
        status: input.status ?? (application as any).stage,
      }
    })

    return updatedApplication
  }

  /**
   * Bulk update application statuses
   */
  static async bulkUpdateStatus(
    applicationIds: string[],
    status: ApplicationStage,
    userId: string,
    rejectionReason?: string,
  ) {
    const result = await prisma.$transaction(async (tx: any) => {
      // Get organization ID for audit
      // Only the count and the first row's job.orgId are read — no need for full
      // Application + Job rows.
      const applications = await tx.application.findMany({
        where: { id: { in: applicationIds } },
        select: { id: true, job: { select: { orgId: true } } },
      })

      if (applications.length === 0) {
        throw new AppError('No applications found', 404)
      }

      const orgId = applications[0].job.orgId

      const updateResult = await tx.application.updateMany({
        where: { id: { in: applicationIds } },
        data: {
          stage: status,
          // Bulk rejection is where a reason matters most — it is the path that
          // turns down twenty people at once, and without this none of them has
          // a recorded why.
          ...(status === 'REJECTED'
            ? { rejectedAt: new Date(), ...(rejectionReason && { rejectionReason }) }
            : { rejectedAt: null, rejectionReason: null }),
        },
      })

      // Create audit log
      await createAuditLog({
        userId,
        orgId,
        action: 'BULK_UPDATE',
        resource: 'APPLICATION',
        resourceId: 'BULK',
        metadata: {
          applicationIds,
          status,
          count: updateResult.count,
        },
      })

      return updateResult.count
    })

    return result
  }

  /**
   * Search applications
   */
  static async searchApplications(params: ApplicationSearchParams) {
    const { jobId, candidateId, stage, status, search, limit = 50, offset = 0 } = params
    const effectiveStage = stage || status

    const where: Prisma.ApplicationWhereInput = {
      ...(jobId && { jobId }),
      ...(candidateId && { candidateId }),
      ...(effectiveStage && { stage: effectiveStage }),
      ...(search && {
        OR: [
          {
            candidate: {
              contacts: {
                some: {
                  OR: [
                    { fullName: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
            },
          },
        ],
      }),
    } as Prisma.ApplicationWhereInput

    // Explicit select: a bare `include` on Job pulls description (up to 10k chars),
    // requirements/responsibilities/benefits and the pipeline/translations/
    // screeningQuestions JSON blobs for every one of up to `limit` rows. Candidate
    // is all cheap scalars, so it keeps its full row + contacts.
    // Rows + total are independent — run them concurrently.
    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where,
        select: {
          id: true,
          candidateId: true,
          jobId: true,
          orgId: true,
          stage: true,
          score: true,
          assignedTo: true,
          tags: true,
          source: true,
          referredBy: true,
          expectedSalary: true,
          availableFrom: true,
          lastContactAt: true,
          lastContactType: true,
          isStarred: true,
          isPriority: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          // coverLetter / stageHistory / scoreDetails / notes omitted — large
          // per-row payloads no caller of this search reads.
          candidate: {
            select: {
              id: true,
              orgId: true,
              userId: true,
              source: true,
              sourceId: true,
              duplicateOf: true,
              mergedInto: true,
              tags: true,
              createdAt: true,
              updatedAt: true,
              deletedAt: true,
              contacts: true,
            },
          },
          job: {
            select: {
              id: true,
              orgId: true,
              title: true,
              city: true,
              region: true,
              country: true,
              remote: true,
              hybrid: true,
              employmentType: true,
              seniority: true,
              salaryMin: true,
              salaryMax: true,
              salaryCurrency: true,
              salaryPeriod: true,
              locale: true,
              status: true,
              publishedAt: true,
              closedAt: true,
              viewCount: true,
              imageUrl: true,
              videoUrl: true,
              requiresAssessment: true,
              assessmentId: true,
              assignedRecruiterId: true,
              slug: true,
              createdBy: true,
              createdAt: true,
              updatedAt: true,
              deletedAt: true,
              organization: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      prisma.application.count({ where }),
    ])

    return { applications, total }
  }

  /**
   * Get application with full details
   */
  static async getApplicationById(applicationId: string) {
    return prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        candidate: true,
        job: {
          include: {
            organization: true,
          },
        },
        events: true,
      },
    } as any)
  }

  /**
   * Delete application (soft delete)
   */
  static async deleteApplication(applicationId: string, userId: string) {
    // Only `job.orgId` is read below (for the audit log).
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      select: { id: true, job: { select: { orgId: true } } },
    })

    if (!application) {
      throw new AppError('Application not found', 404)
    }

    const deletedApplication = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.application.update({
        where: { id: applicationId },
        data: { stage: 'WITHDRAWN' },
      })

      await createAuditLog({
        userId,
        orgId: (application as any).job.orgId,
        action: 'DELETE',
        resource: 'APPLICATION',
        resourceId: applicationId,
        metadata: { status: 'WITHDRAWN' },
      })

      return updated
    })

    return deletedApplication
  }

  /**
   * Send notification about new application
   */
  private static async sendNewApplicationNotification(application: {
    id: string
    job?: any
    candidate?: {
      contacts?: Array<{
        fullName?: string | null
        email?: string | null
      }>
    }
  }): Promise<void> {
    try {
      const { sendEmail } = await import('@/lib/email')

      // Get organization admin email
      const orgAdmin = await prisma.userOrgRole.findFirst({
        where: {
          orgId: application.job?.orgId,
          role: 'ORG_ADMIN',
          deletedAt: null,
        },
        include: {
          user: { select: { email: true, name: true } },
        },
      })

      if (!orgAdmin?.user?.email) {
        logger.warn('No admin email found for organization')
        return
      }

      const candidateName = application.candidate?.contacts?.[0]?.fullName || 'A candidate'
      const jobTitle = application.job?.title || 'a position'
      const appUrl = `${process.env.NEXT_PUBLIC_APP_URL}/employer/applications/${application.id}`

      await sendEmail({
        to: orgAdmin.user.email,
        subject: `New Application for ${jobTitle}`,
        html: `
          <h2>New Application Received</h2>
          <p>Hi ${orgAdmin.user.name || 'there'},</p>
          <p><strong>${candidateName}</strong> has applied for <strong>${jobTitle}</strong>.</p>
          <p><a href="${appUrl}" style="display: inline-block; padding: 12px 24px; background-color: #0070f3; color: white; text-decoration: none; border-radius: 5px;">View Application</a></p>
          <hr />
          <p style="color: #666; font-size: 12px;">JobSphere ATS - Modern recruitment platform</p>
        `,
      })
    } catch (error) {
      logger.error('Failed to send new application notification:', error)
      // Don't fail the request if email fails
    }
  }

  /**
   * Create notification for status change
   */
  private static async createStatusChangeNotification(
    application: {
      id: string
      candidate?: {
        contacts?: Array<{
          email?: string | null
          fullName?: string | null
        }>
      }
      job?: any
    },
    newStage: ApplicationStage,
  ): Promise<void> {
    try {
      const { sendEmail } = await import('@/lib/email')

      const candidateEmail = application.candidate?.contacts?.[0]?.email
      if (!candidateEmail) {
        logger.warn('No candidate email found for notification')
        return
      }

      const candidateName = application.candidate?.contacts?.[0]?.fullName || 'there'
      const jobTitle = application.job?.title || 'the position'

      let subject = ''
      let message = ''

      if (newStage === 'INTERVIEW') {
        subject = `Interview Invitation - ${jobTitle}`
        message = `
          <h2>You're Invited for an Interview!</h2>
          <p>Hi ${candidateName},</p>
          <p>Great news! We'd like to invite you for an interview for the <strong>${jobTitle}</strong> position.</p>
          <p>The hiring team will reach out to you soon with more details about the interview schedule.</p>
          <p>Good luck!</p>
        `
      } else if (newStage === 'HIRED') {
        subject = `Job Offer - ${jobTitle}`
        message = `
          <h2>Congratulations! Job Offer</h2>
          <p>Hi ${candidateName},</p>
          <p>We're excited to offer you the <strong>${jobTitle}</strong> position!</p>
          <p>A member of our team will contact you shortly with the offer details.</p>
          <p>Congratulations on this achievement!</p>
        `
      } else {
        return // Only send for INTERVIEW and HIRED stages
      }

      await sendEmail({
        to: candidateEmail,
        subject,
        html: `
          ${message}
          <hr />
          <p style="color: #666; font-size: 12px;">JobSphere ATS - Modern recruitment platform</p>
        `,
      })
    } catch (error) {
      logger.error('Failed to send status change notification:', error)
      // Don't fail the request if email fails
    }
  }

  /**
   * Get application statistics for a job
   */
  static async getApplicationStats(jobId: string): Promise<{
    total: number
    byStatus: Record<string, number>
    todayCount: number
    weekCount: number
  }> {
    const now = new Date()
    const startOfDay = new Date(now)
    startOfDay.setHours(0, 0, 0, 0)
    const startOfWeek = new Date(now)
    startOfWeek.setDate(startOfWeek.getDate() - 7)

    const byStatus = await (prisma.application as any).groupBy({
      by: ['stage'],
      where: { jobId },
      _count: { stage: true },
    })
    const todayCount = await prisma.application.count({
      where: {
        jobId,
        createdAt: { gte: startOfDay },
      },
    })
    const weekCount = await prisma.application.count({
      where: {
        jobId,
        createdAt: { gte: startOfWeek },
      },
    })

    const statusCounts = (byStatus as any[]).reduce(
      (acc: Record<string, number>, item: any) => {
        acc[item.stage] = item._count.stage
        return acc
      },
      {} as Record<string, number>,
    )

    const total = Object.values(statusCounts).reduce((sum, count) => sum + count, 0)

    return {
      total,
      byStatus: statusCounts,
      todayCount,
      weekCount,
    }
  }
}
