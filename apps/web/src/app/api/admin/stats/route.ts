/**
 * GET /api/admin/stats — platform KPIs and "needs attention" counters for the super admin.
 * Counts only; no PII, no secrets.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { withRateLimit } from '@/lib/rate-limit'
import { getAdminKpis, getAttentionCounts } from '@/lib/admin/overview'

export const runtime = 'nodejs'

const handler = async () => {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!session.user.isGlobalAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const [kpis, attention] = await Promise.all([getAdminKpis(), getAttentionCounts()])
  return NextResponse.json({ kpis, attention }, { headers: { 'Cache-Control': 'no-store' } })
}

export const GET = withRateLimit(handler, { preset: 'api', byUser: true })
