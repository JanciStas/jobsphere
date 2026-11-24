import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    blogPost: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    blogCategory: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { getPublishedPost, listBlogCategories, listPublishedPosts } from '../queries'
import { getBlogSitemapEntries } from '../sitemap'
import {
  categoryName,
  fromZonedInputValue,
  isLive,
  isScheduled,
  readingTimeMinutes,
  toZonedInputValue,
} from '../shared'

const tableMissing = () =>
  Object.assign(new Error('relation "BlogPost" does not exist'), { code: 'P2021' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.blogPost.findMany).mockResolvedValue([])
  vi.mocked(prisma.blogPost.count).mockResolvedValue(0)
})

describe('listPublishedPosts', () => {
  it('hides drafts and scheduled posts: PUBLISHED and publishedAt <= now', async () => {
    const before = Date.now()
    await listPublishedPosts('sk', { page: 2, categorySlug: 'kariera' })
    const args = vi.mocked(prisma.blogPost.findMany).mock.calls[0][0] as any
    expect(args.where.status).toBe('PUBLISHED')
    expect(args.where.locale).toBe('sk')
    expect(args.where.category).toEqual({ slug: 'kariera' })
    expect(args.where.publishedAt.lte).toBeInstanceOf(Date)
    expect(args.where.publishedAt.lte.getTime()).toBeGreaterThanOrEqual(before)
    expect(args.where.publishedAt.gt).toBeUndefined()
    expect(args.orderBy[0]).toEqual({ publishedAt: 'desc' })
    expect(args.take).toBe(12)
    expect(args.skip).toBe(12)
    // count uses the same filter, so pagination never counts hidden posts
    expect(vi.mocked(prisma.blogPost.count).mock.calls[0][0]).toEqual({ where: args.where })
  })

  it('returns an empty result when the CMS tables are missing', async () => {
    vi.mocked(prisma.blogPost.findMany).mockRejectedValue(tableMissing())
    vi.mocked(prisma.blogPost.count).mockRejectedValue(tableMissing())
    await expect(listPublishedPosts('sk')).resolves.toEqual({
      posts: [],
      total: 0,
      page: 1,
      pageCount: 0,
    })
  })

  it('computes the page count and ignores an invalid category slug', async () => {
    vi.mocked(prisma.blogPost.count).mockResolvedValue(25)
    const res = await listPublishedPosts('en', { page: 1 })
    expect(res.pageCount).toBe(3)
    const bad = await listPublishedPosts('en', { categorySlug: '../../x' })
    expect(bad.total).toBe(0)
    expect(prisma.blogPost.findMany).toHaveBeenCalledTimes(1)
  })

  it('categories filter only counts live posts of the locale', async () => {
    vi.mocked(prisma.blogCategory.findMany).mockResolvedValue([])
    await listBlogCategories('de')
    const args = vi.mocked(prisma.blogCategory.findMany).mock.calls[0][0] as any
    expect(args.where.posts.some.locale).toBe('de')
    expect(args.where.posts.some.status).toBe('PUBLISHED')
    expect(args.where.posts.some.publishedAt.lte).toBeInstanceOf(Date)
  })
})

describe('getPublishedPost', () => {
  it('queries only live posts of slug + locale', async () => {
    vi.mocked(prisma.blogPost.findFirst).mockResolvedValue(null)
    await expect(getPublishedPost('moj-clanok', 'sk')).resolves.toBeNull()
    const args = vi.mocked(prisma.blogPost.findFirst).mock.calls[0][0] as any
    expect(args.where).toMatchObject({ slug: 'moj-clanok', locale: 'sk', status: 'PUBLISHED' })
    expect(args.where.publishedAt.lte).toBeInstanceOf(Date)
  })

  it('rejects malformed slugs without a query and survives a missing table', async () => {
    await expect(getPublishedPost('Bad Slug', 'sk')).resolves.toBeNull()
    expect(prisma.blogPost.findFirst).not.toHaveBeenCalled()
    vi.mocked(prisma.blogPost.findFirst).mockRejectedValue(tableMissing())
    await expect(getPublishedPost('ok', 'sk')).resolves.toBeNull()
  })
})

describe('getBlogSitemapEntries', () => {
  it('lists live posts per locale and never throws', async () => {
    const updatedAt = new Date('2026-11-01T10:00:00Z')
    vi.mocked(prisma.blogPost.findMany).mockResolvedValue([
      { slug: 'a', locale: 'sk', updatedAt },
    ] as any)
    const entries = await getBlogSitemapEntries('https://jobsphere.eu')
    expect(entries).toEqual([
      expect.objectContaining({ url: 'https://jobsphere.eu/sk/blog/a', lastModified: updatedAt }),
    ])
    const args = vi.mocked(prisma.blogPost.findMany).mock.calls[0][0] as any
    expect(args.where.status).toBe('PUBLISHED')
    expect(args.where.publishedAt.lte).toBeInstanceOf(Date)

    vi.mocked(prisma.blogPost.findMany).mockRejectedValue(new Error('db down'))
    await expect(getBlogSitemapEntries('https://jobsphere.eu')).resolves.toEqual([])
  })
})

describe('readingTimeMinutes', () => {
  it('is at least one minute', () => {
    expect(readingTimeMinutes('')).toBe(1)
    expect(readingTimeMinutes(null)).toBe(1)
    expect(readingTimeMinutes('Krátky text.')).toBe(1)
  })
  it('counts ~200 words per minute and ignores markup, URLs and code', () => {
    expect(readingTimeMinutes('slovo '.repeat(1000))).toBe(5)
    const md = `## Nadpis\n\n${'**slovo** '.repeat(400)}\n\n[odkaz](https://example.com/a/b/c) ![obr](https://x/y.png)\n\n\`\`\`\n${'code '.repeat(2000)}\n\`\`\``
    expect(readingTimeMinutes(md)).toBe(2)
  })
})

describe('categoryName', () => {
  const names = { sk: 'Kariéra', en: 'Career', de: '' }
  it('uses the locale, then sk, en, any, then the slug', () => {
    expect(categoryName(names, 'en', 'kariera')).toBe('Career')
    expect(categoryName(names, 'de', 'kariera')).toBe('Kariéra')
    expect(categoryName({ pl: 'Kariera' }, 'cs', 'kariera')).toBe('Kariera')
    expect(categoryName({}, 'sk', 'kariera')).toBe('kariera')
    expect(categoryName(null, 'sk', 'kariera')).toBe('kariera')
  })
})

describe('scheduling helpers', () => {
  it('isScheduled / isLive', () => {
    const now = new Date('2026-11-24T12:00:00Z')
    const future = { status: 'PUBLISHED', publishedAt: new Date('2026-11-25T00:00:00Z') }
    const past = { status: 'PUBLISHED', publishedAt: new Date('2026-11-01T00:00:00Z') }
    expect(isScheduled(future, now)).toBe(true)
    expect(isLive(future, now)).toBe(false)
    expect(isLive(past, now)).toBe(true)
    expect(isLive({ status: 'DRAFT', publishedAt: past.publishedAt }, now)).toBe(false)
  })

  it('converts datetime-local values in Europe/Bratislava time (DST aware)', () => {
    // Winter: UTC+1
    expect(fromZonedInputValue('2026-01-15T09:30')?.toISOString()).toBe('2026-01-15T08:30:00.000Z')
    // Summer: UTC+2
    expect(fromZonedInputValue('2026-07-15T09:30')?.toISOString()).toBe('2026-07-15T07:30:00.000Z')
    expect(toZonedInputValue('2026-07-15T07:30:00.000Z')).toBe('2026-07-15T09:30')
    expect(toZonedInputValue(null)).toBe('')
    expect(fromZonedInputValue('')).toBeNull()
    expect(fromZonedInputValue('garbage')).toBeNull()
  })
})
