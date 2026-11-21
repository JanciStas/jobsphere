/**
 * Ends manually granted plans on schedule (Vercel Cron, daily).
 *
 * A plan granted in the super-admin billing screen is a `manual_*` Subscription row with no
 * Stripe behind it, so no `subscription.deleted` webhook ever ends it. Without this job the
 * feature limits it unlocked (Entitlement rows) stayed on forever. See
 * `expireManualSubscriptions` in lib/admin-billing.ts.
 */

import { NextResponse } from 'next/server'
import { expireManualSubscriptions } from '@/lib/admin-billing'
import { requireCronAuth, CronAuthError } from '@/lib/jobs/cron-auth'
import { withRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const maxDuration = 60

export const GET = withRateLimit(
  async (request: Request) => {
    try {
      requireCronAuth(request)
    } catch (error) {
      if (error instanceof CronAuthError) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      throw error
    }

    try {
      const result = await expireManualSubscriptions()
      if (result.expired > 0 || result.failed > 0) {
        logger.info('Manual plan expiry run', { ...result })
      }
      return NextResponse.json({ ok: true, ...result })
    } catch (error) {
      logger.error('Manual plan expiry cron failed', { error })
      return NextResponse.json({ ok: false, error: 'Expiry run failed' }, { status: 500 })
    }
  },
  { preset: 'strict' },
)
