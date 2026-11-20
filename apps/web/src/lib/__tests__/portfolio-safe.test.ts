import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({
  prisma: { portfolioItem: { findMany: vi.fn(), count: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import { isMissingTableError, listPortfolioItems, countPortfolioItems } from '../portfolio-safe'

const findMany = prisma.portfolioItem.findMany as ReturnType<typeof vi.fn>
const count = prisma.portfolioItem.count as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('isMissingTableError', () => {
  it('detects P2021, P2022 and "does not exist" messages', () => {
    expect(isMissingTableError({ code: 'P2021' })).toBe(true)
    expect(isMissingTableError({ code: 'P2022' })).toBe(true)
    expect(isMissingTableError(new Error('relation "PortfolioItem" does not exist'))).toBe(true)
    expect(isMissingTableError(new Error('boom'))).toBe(false)
    expect(isMissingTableError(null)).toBe(false)
  })
})

describe('listPortfolioItems / countPortfolioItems', () => {
  it('returns empty list when the table is missing', async () => {
    findMany.mockRejectedValue({ code: 'P2021' })
    count.mockRejectedValue({ code: 'P2021' })
    await expect(listPortfolioItems('f1')).resolves.toEqual([])
    await expect(countPortfolioItems('f1')).resolves.toBe(0)
  })
  it('rethrows other errors', async () => {
    findMany.mockRejectedValue(new Error('connection lost'))
    await expect(listPortfolioItems('f1')).rejects.toThrow('connection lost')
  })
  it('returns rows on success', async () => {
    findMany.mockResolvedValue([{ id: 'a' }])
    await expect(listPortfolioItems('f1')).resolves.toEqual([{ id: 'a' }])
  })
})
