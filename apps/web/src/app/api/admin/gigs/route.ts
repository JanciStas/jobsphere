import { NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/errors'
import { withRateLimit } from '@/lib/rate-limit'
import { requireAdminApi, parsePaging } from '@/lib/admin-guard'
import { listGigs } from '@/lib/admin-marketplace'

export const runtime = 'nodejs'

async function list(req: Request) {
  try {
    const guard = await requireAdminApi()
    if (!guard.ok) return guard.response

    const sp = new URL(req.url).searchParams
    const { page, limit } = parsePaging(sp)
    const result = await listGigs({
      search: sp.get('search') ?? undefined,
      status: sp.get('status') ?? undefined,
      orgId: sp.get('orgId') ?? undefined,
      agency: sp.get('agency') ?? undefined,
      page,
      limit,
    })
    return NextResponse.json(result)
  } catch (error) {
    logger.error('Admin GET /gigs error:', error)
    return handleApiError(error)
  }
}

export const GET = withRateLimit(list, { preset: 'api', byUser: true })
