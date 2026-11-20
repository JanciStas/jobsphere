/**
 * Admin audit-log CSV export.
 * GET /api/admin/audit/export?action=&entityType=&user=&from=&to=
 * Requires isGlobalAdmin; at most 5000 rows; userAgent is never exported.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withRateLimit } from '@/lib/rate-limit'
import { parseAuditFilters, queryAuditExport, auditRowsToCsv } from '@/lib/admin/audit-query'

export const runtime = 'nodejs'

const handler = async (req: Request) => {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!session.user.isGlobalAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const url = new URL(req.url)
    const filters = parseAuditFilters(Object.fromEntries(url.searchParams.entries()))
    const rows = await queryAuditExport(filters)
    const csv = auditRowsToCsv(rows)

    await createAuditLog({
      userId: session.user.id,
      action: 'DATA_EXPORTED',
      resource: 'USER',
      resourceId: 'audit-log',
      metadata: {
        export: 'audit_log',
        rows: rows.length,
        filters: {
          action: filters.action ?? null,
          entityType: filters.entityType ?? null,
          user: filters.user ?? null,
          from: filters.from ?? null,
          to: filters.to ?? null,
        },
      },
      ...getRequestMetadata(req),
    })

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    logger.error('Admin GET /audit/export failed', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const GET = withRateLimit(handler, { preset: 'strict', byUser: true })
