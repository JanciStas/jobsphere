import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveActiveMembership } from '@/lib/api-helpers'
import { logger } from '@/lib/logger'
import { errorResponse } from '@/lib/errors'
import { withRateLimit } from '@/lib/rate-limit'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'

export const GET = withRateLimit(
  async (_req: Request) => {
    try {
      logger.apiRequest('GET', '/api/user/cvs')

      const session = await requireAuth()
      if (!session.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Get user's organization membership to find candidates
      const userOrg = await resolveActiveMembership(session.user.id, session.user.activeOrgId)

      if (!userOrg) {
        return NextResponse.json({ cvs: [] })
      }

      // Get candidate profile for this organization (must belong to the caller)
      const candidate = await prisma.candidate.findFirst({
        where: { orgId: userOrg.orgId, userId: session.user.id },
      })

      if (!candidate) {
        return NextResponse.json({ cvs: [] })
      }

      // Fetch user's resumes
      const resumes = await prisma.resume.findMany({
        where: {
          candidateId: candidate.id,
        },
        select: {
          id: true,
          summary: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        // A person has a handful of CVs; `take` is a safety net against an
        // unbounded scan. The `id` tiebreaker keeps `isDefault: index === 0`
        // (below) stable when two resumes share a createdAt.
        take: 100,
      })

      // Format for frontend
      const cvs = resumes.map((resume, index) => ({
        id: resume.id,
        title: resume.summary ? resume.summary.substring(0, 50) + '...' : 'Untitled CV',
        uploadedAt: resume.createdAt.toLocaleDateString(),
        isDefault: index === 0, // Mark first as default
      }))

      return NextResponse.json(cvs)
    } catch (error) {
      logger.apiError('GET', '/api/user/cvs', error)
      const errorData = errorResponse(error)
      return NextResponse.json({ error: errorData.error }, { status: errorData.statusCode })
    }
  },
  { preset: 'api', byUser: true },
)
