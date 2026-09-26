import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveActiveMembership } from '@/lib/api-helpers'
import { logger } from '@/lib/logger'
import { errorResponse } from '@/lib/errors'
import { withRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

export const GET = withRateLimit(
  async (req: Request) => {
    try {
      logger.apiRequest('GET', '/api/applications/export')

      const session = await auth()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Get user's organization
      const membership = await resolveActiveMembership(session.user.id, session.user.activeOrgId)

      if (!membership) {
        return NextResponse.json({ error: 'No organization found' }, { status: 403 })
      }

      // AUTH-006: PII export is restricted to admins and recruiters.
      // Hiring managers and external agencies must not bulk-export candidate PII.
      if (!['ORG_ADMIN', 'RECRUITER'].includes(membership.role)) {
        return NextResponse.json(
          { error: 'You do not have permission to export applicant data' },
          { status: 403 },
        )
      }

      // Get all applications for organization
      const applications = await prisma.application.findMany({
        where: {
          // Application.orgId (own column) — avoids a join against Job and lets
          // @@index([orgId, stage, createdAt]) serve the org scan.
          orgId: membership.orgId,
        },
        include: {
          job: {
            select: {
              title: true,
            },
          },
          candidate: {
            include: {
              contacts: {
                where: { isPrimary: true },
                take: 1,
              },
              documents: {
                where: { type: 'CV', deletedAt: null },
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { id: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      // Generate CSV content
      const csvHeaders = [
        'Name',
        'Email',
        'Phone',
        'Job Title',
        'Stage',
        'Applied Date',
        'CV Link',
        'LinkedIn',
        'GitHub',
        'Location',
      ]

      // Build an absolute base URL so the CV link works when the CSV is opened
      // outside the app. The link points at the authenticated download route
      // (SEC-001) — never the raw storage URL.
      const origin = new URL(req.url).origin

      const csvRows = applications.map((app) => {
        const contact = app.candidate.contacts?.[0]
        const cvDoc = app.candidate.documents?.[0]

        return [
          contact?.fullName || '',
          contact?.email || '',
          contact?.phone || '',
          app.job.title,
          app.stage,
          new Date(app.createdAt).toLocaleDateString(),
          cvDoc?.id ? `${origin}/api/cv/${cvDoc.id}/download` : '',
          contact?.linkedIn || '',
          contact?.github || '',
          contact?.location || '',
        ].map((field) => {
          // Escape quotes and wrap in quotes to handle commas
          const escaped = String(field).replace(/"/g, '""')
          return `"${escaped}"`
        })
      })

      const csv = [csvHeaders.join(','), ...csvRows.map((row) => row.join(','))].join('\n')

      logger.info('CSV export generated', {
        userId: session.user.id,
        orgId: membership.orgId,
        recordCount: applications.length,
      })

      // Return CSV with proper headers
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="applicants-${new Date().toISOString().split('T')[0]}.csv"`,
        },
      })
    } catch (error) {
      logger.apiError('GET', '/api/applications/export', error)
      const errorData = errorResponse(error)
      return NextResponse.json({ error: errorData.error }, { status: errorData.statusCode })
    }
  },
  { preset: 'api', byUser: true },
)
