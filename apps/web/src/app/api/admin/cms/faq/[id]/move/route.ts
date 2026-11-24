/**
 * Admin CMS FAQ: move an entry one position up or down within its locale.
 *   POST { direction: 'up' | 'down' }
 * Renumbers the locale's sortOrder 0..n-1 so ties (e.g. all 0) cannot block a move.
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/errors'
import { requireAdminApi } from '@/lib/admin-guard'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { CMS_NOT_MIGRATED, isCmsTableMissing } from '@/lib/cms/safe'
import { revalidateFaq } from '@/lib/cms/faq'

type Context = { params?: Record<string, string> }

const bodySchema = z.object({ direction: z.enum(['up', 'down']) }).strict()

export const POST = withCsrfProtection(
  withRateLimit(
    async (request: Request, context?: Context) => {
      const guard = await requireAdminApi()
      if (!guard.ok) return guard.response
      const params = await context?.params
      const id = z.string().min(1).max(64).safeParse(params?.id)
      if (!id.success) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

      const parsed = bodySchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
      const { direction } = parsed.data

      try {
        const item = await prisma.cmsFaqItem.findUnique({
          where: { id: id.data },
          select: { id: true, locale: true },
        })
        if (!item) return NextResponse.json({ error: 'FAQ item not found' }, { status: 404 })

        const siblings = await prisma.cmsFaqItem.findMany({
          where: { locale: item.locale },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, sortOrder: true },
        })
        const from = siblings.findIndex((s) => s.id === item.id)
        const to = direction === 'up' ? from - 1 : from + 1
        if (from < 0 || to < 0 || to >= siblings.length) {
          return NextResponse.json({ moved: false })
        }

        const order = siblings.map((s) => s.id)
        order.splice(to, 0, ...order.splice(from, 1))
        const current = new Map(siblings.map((s) => [s.id, s.sortOrder]))
        await prisma.$transaction(
          order
            .map((sid, index) => ({ sid, index }))
            .filter(({ sid, index }) => current.get(sid) !== index)
            .map(({ sid, index }) =>
              prisma.cmsFaqItem.update({ where: { id: sid }, data: { sortOrder: index } }),
            ),
        )

        await createAuditLog({
          userId: guard.session.user.id,
          action: 'UPDATE',
          resource: 'CMS_FAQ',
          resourceId: item.id,
          previous: { position: from },
          metadata: { locale: item.locale, position: to, direction },
          ...getRequestMetadata(request),
        })
        revalidateFaq()
        return NextResponse.json({ moved: true })
      } catch (error) {
        if (isCmsTableMissing(error)) return NextResponse.json(CMS_NOT_MIGRATED, { status: 503 })
        logger.error('Admin POST /cms/faq/[id]/move error', { error })
        return handleApiError(error)
      }
    },
    { preset: 'api', byUser: true },
  ),
)
