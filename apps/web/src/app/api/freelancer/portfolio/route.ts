/**
 * Freelancer portfolio API — list + create the logged-in freelancer's own items.
 * Reads degrade to [] and writes to 503 while the PortfolioItem table is missing
 * (see docs/PORTFOLIO_MIGRATION.md).
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'
import { logger } from '@/lib/logger'
import {
  isMissingTableError,
  listPortfolioItems,
  MAX_PORTFOLIO_ITEMS,
  PORTFOLIO_SELECT,
} from '@/lib/portfolio-safe'
import { createPortfolioSchema } from './schema'

export const GET = withRateLimit(
  async () => {
    try {
      const session = await auth()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const profile = await prisma.freelancerProfile.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      })
      if (!profile) return NextResponse.json({ items: [] })
      const items = await listPortfolioItems(profile.id)
      return NextResponse.json({ items })
    } catch (error) {
      logger.error('Portfolio list error', { error })
      return NextResponse.json({ error: 'Failed to load portfolio' }, { status: 500 })
    }
  },
  { preset: 'api' },
)

export const POST = withCsrfProtection(
  withRateLimit(
    async (request: Request) => {
      try {
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }
        const profile = await prisma.freelancerProfile.findUnique({
          where: { userId: session.user.id },
          select: { id: true },
        })
        if (!profile) {
          return NextResponse.json({ error: 'Freelancer profile required' }, { status: 403 })
        }

        const body = await request.json().catch(() => null)
        const parsed = createPortfolioSchema.safeParse(body)
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Invalid data', details: parsed.error.errors },
            { status: 400 },
          )
        }

        const existing = await prisma.portfolioItem.count({ where: { freelancerId: profile.id } })
        if (existing >= MAX_PORTFOLIO_ITEMS) {
          return NextResponse.json(
            { error: `Portfolio limit reached (${MAX_PORTFOLIO_ITEMS})` },
            { status: 409 },
          )
        }

        const d = parsed.data
        const item = await prisma.portfolioItem.create({
          data: {
            freelancerId: profile.id,
            title: d.title,
            description: d.description ?? null,
            url: d.url ?? null,
            imageUrl: d.imageUrl ?? null,
            tags: d.tags ?? [],
            sortOrder: d.sortOrder ?? existing,
          },
          select: PORTFOLIO_SELECT,
        })
        return NextResponse.json({ item }, { status: 201 })
      } catch (error) {
        if (isMissingTableError(error)) {
          return NextResponse.json(
            { error: 'Portfolio is temporarily unavailable (database migration pending)' },
            { status: 503 },
          )
        }
        logger.error('Portfolio create error', { error })
        return NextResponse.json({ error: 'Failed to create item' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)
