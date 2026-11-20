/**
 * POST /api/admin/billing/[orgId]/limits — super-admin only (401/403), Zod body with
 * mandatory `reason`, DB-only (no Stripe call), audit-logged in lib/admin-billing.
 */
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { limitSchema, setLimitOverride, runBillingAction } from '@/lib/admin-billing'

export const runtime = 'nodejs'

export const POST = withCsrfProtection(
  withRateLimit(
    (req: Request, context?: { params?: Record<string, string> }) =>
      runBillingAction(req, context, limitSchema, (a) => setLimitOverride(a)),
    { preset: 'api', byUser: true },
  ),
)
