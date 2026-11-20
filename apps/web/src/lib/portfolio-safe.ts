/**
 * Safe access to PortfolioItem. The production DB may not have the table yet
 * (see docs/PORTFOLIO_MIGRATION.md), so reads degrade to an empty list and
 * writes surface a recognizable "table missing" condition instead of a 500.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export interface PortfolioItemDTO {
  id: string
  title: string
  description: string | null
  url: string | null
  imageUrl: string | null
  tags: string[]
  sortOrder: number
}

const SELECT = {
  id: true,
  title: true,
  description: true,
  url: true,
  imageUrl: true,
  tags: true,
  sortOrder: true,
} as const

/** True when the error means the PortfolioItem table/column is missing in the DB. */
export function isMissingTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; message?: unknown }
  if (e.code === 'P2021' || e.code === 'P2022') return true
  return typeof e.message === 'string' && /does not exist/i.test(e.message)
}

/** Public/owner read: never throws because of a missing table. */
export async function listPortfolioItems(freelancerId: string): Promise<PortfolioItemDTO[]> {
  try {
    return await prisma.portfolioItem.findMany({
      where: { freelancerId },
      select: SELECT,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    })
  } catch (error) {
    if (isMissingTableError(error)) return []
    logger.error('Portfolio read error', { error })
    throw error
  }
}

export async function countPortfolioItems(freelancerId: string): Promise<number> {
  try {
    return await prisma.portfolioItem.count({ where: { freelancerId } })
  } catch (error) {
    if (isMissingTableError(error)) return 0
    logger.error('Portfolio count error', { error })
    throw error
  }
}

export const PORTFOLIO_SELECT = SELECT
export const MAX_PORTFOLIO_ITEMS = 24
