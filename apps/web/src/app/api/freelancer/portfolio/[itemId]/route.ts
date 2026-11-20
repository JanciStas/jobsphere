/**
 * Freelancer portfolio item — update / delete. Ownership is enforced through
 * FreelancerProfile.userId === session user; a foreign or unknown item is a 404.
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'
import { logger } from '@/lib/logger'
import { isMissingTableError, PORTFOLIO_SELECT } from '@/lib/portfolio-safe'
import { updatePortfolioSchema } from '../schema'

type Ctx = { params?: Record<string, string> }

const unavailable = () =>
  NextResponse.json(
    { error: 'Portfolio is temporarily unavailable (database migration pending)' },
    { status: 503 },
  )

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (request: Request, context?: Ctx) => {
      try {
        const itemId = context?.params?.itemId
        if (!itemId) return NextResponse.json({ error: 'Missing item id' }, { status: 400 })

        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json().catch(() => null)
        const parsed = updatePortfolioSchema.safeParse(body)
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Invalid data', details: parsed.error.errors },
            { status: 400 },
          )
        }

        // Ownership scoped in the query: foreign items are indistinguishable from missing ones.
        const owned = await prisma.portfolioItem.findFirst({
          where: { id: itemId, freelancer: { userId: session.user.id } },
          select: { id: true },
        })
        if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        const d = parsed.data
        const item = await prisma.portfolioItem.update({
          where: { id: itemId },
          data: {
            ...(d.title !== undefined && { title: d.title }),
            ...(d.description !== undefined && { description: d.description }),
            ...(d.url !== undefined && { url: d.url }),
            ...(d.imageUrl !== undefined && { imageUrl: d.imageUrl }),
            ...(d.tags !== undefined && { tags: d.tags }),
            ...(d.sortOrder !== undefined && { sortOrder: d.sortOrder }),
          },
          select: PORTFOLIO_SELECT,
        })
        return NextResponse.json({ item })
      } catch (error) {
        if (isMissingTableError(error)) return unavailable()
        logger.error('Portfolio update error', { error })
        return NextResponse.json({ error: 'Failed to update item' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)

export const DELETE = withCsrfProtection(
  withRateLimit(
    async (_request: Request, context?: Ctx) => {
      try {
        const itemId = context?.params?.itemId
        if (!itemId) return NextResponse.json({ error: 'Missing item id' }, { status: 400 })

        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const owned = await prisma.portfolioItem.findFirst({
          where: { id: itemId, freelancer: { userId: session.user.id } },
          select: { id: true },
        })
        if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

        await prisma.portfolioItem.delete({ where: { id: itemId } })
        return NextResponse.json({ ok: true })
      } catch (error) {
        if (isMissingTableError(error)) return unavailable()
        logger.error('Portfolio delete error', { error })
        return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)
