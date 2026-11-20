/**
 * Portfolio moderation. PortfolioItem may be missing from the production DB
 * (migration pending), so every write maps the "table missing" condition to 503.
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/errors'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { requireAdminApi } from '@/lib/admin-guard'
import { httpUrl } from '@/lib/admin-marketplace'
import { isMissingTableError } from '@/lib/portfolio-safe'

export const runtime = 'nodejs'

const unavailable = () =>
  NextResponse.json({ error: 'Portfolio is temporarily unavailable' }, { status: 503 })

const patchSchema = z
  .object({
    title: z.string().trim().min(1).max(150).optional(),
    description: z.string().trim().max(3000).nullable().optional(),
    url: httpUrl.nullable().optional(),
  })
  .strict()

const ITEM_SELECT = { id: true, title: true, description: true, url: true } as const

function ids(context?: { params?: Record<string, string> }) {
  const freelancerId = context?.params?.id
  const itemId = context?.params?.itemId
  return freelancerId && itemId ? { freelancerId, itemId } : null
}

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      try {
        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response
        const p = ids(context)
        if (!p) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

        const data = patchSchema.parse(await req.json())
        if (Object.keys(data).length === 0) {
          return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
        }

        try {
          // Scoped by freelancerId so an item id from another profile is a 404.
          const before = await prisma.portfolioItem.findFirst({
            where: { id: p.itemId, freelancerId: p.freelancerId },
            select: ITEM_SELECT,
          })
          if (!before) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

          const updated = await prisma.portfolioItem.update({
            where: { id: p.itemId },
            data,
            select: ITEM_SELECT,
          })
          await createAuditLog({
            userId: guard.session.user.id,
            action: 'UPDATE',
            resource: 'PORTFOLIO_ITEM',
            resourceId: p.itemId,
            previous: { freelancerId: p.freelancerId, ...before },
            metadata: { freelancerId: p.freelancerId, ...updated },
            ...getRequestMetadata(req),
          })
          return NextResponse.json({ item: updated })
        } catch (error) {
          if (isMissingTableError(error)) return unavailable()
          throw error
        }
      } catch (error) {
        logger.error('Admin PATCH portfolio item error:', error)
        return handleApiError(error)
      }
    },
    { preset: 'api' },
  ),
)

export const DELETE = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: { params?: Record<string, string> }) => {
      try {
        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response
        const p = ids(context)
        if (!p) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

        try {
          const before = await prisma.portfolioItem.findFirst({
            where: { id: p.itemId, freelancerId: p.freelancerId },
            select: ITEM_SELECT,
          })
          if (!before) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

          await prisma.portfolioItem.delete({ where: { id: p.itemId } })
          await createAuditLog({
            userId: guard.session.user.id,
            action: 'DELETE',
            resource: 'PORTFOLIO_ITEM',
            resourceId: p.itemId,
            previous: { freelancerId: p.freelancerId, ...before },
            ...getRequestMetadata(req),
          })
          return NextResponse.json({ success: true })
        } catch (error) {
          if (isMissingTableError(error)) return unavailable()
          throw error
        }
      } catch (error) {
        logger.error('Admin DELETE portfolio item error:', error)
        return handleApiError(error)
      }
    },
    { preset: 'api' },
  ),
)
