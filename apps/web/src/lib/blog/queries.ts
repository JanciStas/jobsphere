/**
 * Public blog reads. Every query goes through cmsRead, so while the CMS tables are missing
 * in production the blog degrades to its empty ("coming soon") state instead of a 500.
 *
 * Visibility rule (the only one): status PUBLISHED and publishedAt <= now. A PUBLISHED
 * post with a future publishedAt is scheduled and stays hidden until then.
 */

import * as React from 'react'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { cmsRead } from '@/lib/cms/safe'
import { SLUG_MAX, SLUG_REGEX } from '@/lib/cms/constants'
import { BLOG_PAGE_SIZE } from './shared'

/**
 * React's per-request memoization (Next's bundled React). Plain React 18 (vitest) has no
 * `cache`, so fall back to the bare function there.
 */
const cache: <F extends (...args: never[]) => unknown>(fn: F) => F =
  typeof (React as { cache?: unknown }).cache === 'function'
    ? (React as unknown as { cache: <F>(fn: F) => F }).cache
    : (fn) => fn

/** `where` for posts visible on the public site at `now`. */
export function publishedWhere(now: Date = new Date()): Prisma.BlogPostWhereInput {
  return { status: 'PUBLISHED', publishedAt: { lte: now } }
}

const categorySelect = { id: true, slug: true, names: true, sortOrder: true } as const

const listSelect = {
  id: true,
  slug: true,
  locale: true,
  title: true,
  excerpt: true,
  body: true,
  coverImage: true,
  tags: true,
  publishedAt: true,
  updatedAt: true,
  category: { select: categorySelect },
} as const

export type BlogCategoryRow = Prisma.BlogCategoryGetPayload<{ select: typeof categorySelect }>
export type BlogListPost = Prisma.BlogPostGetPayload<{ select: typeof listSelect }>

export interface BlogListResult {
  posts: BlogListPost[]
  total: number
  page: number
  pageCount: number
}

function isValidSlug(slug: string | undefined | null): slug is string {
  return typeof slug === 'string' && slug.length <= SLUG_MAX && SLUG_REGEX.test(slug)
}

/** Published posts of one locale, newest first, 12 per page, optionally of one category. */
export async function listPublishedPosts(
  locale: string,
  { categorySlug, page = 1 }: { categorySlug?: string | null; page?: number } = {},
): Promise<BlogListResult> {
  const safePage = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
  const empty: BlogListResult = { posts: [], total: 0, page: safePage, pageCount: 0 }
  if (categorySlug && !isValidSlug(categorySlug)) return empty

  const where: Prisma.BlogPostWhereInput = {
    ...publishedWhere(),
    locale,
    ...(categorySlug ? { category: { slug: categorySlug } } : {}),
  }

  return cmsRead(
    'blog.listPublishedPosts',
    async () => {
      const [posts, total] = await Promise.all([
        prisma.blogPost.findMany({
          where,
          select: listSelect,
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          skip: (safePage - 1) * BLOG_PAGE_SIZE,
          take: BLOG_PAGE_SIZE,
        }),
        prisma.blogPost.count({ where }),
      ])
      return { posts, total, page: safePage, pageCount: Math.ceil(total / BLOG_PAGE_SIZE) }
    },
    empty,
  )
}

/** Categories that have at least one live post in `locale` (for the filter chips). */
export async function listBlogCategories(locale: string): Promise<BlogCategoryRow[]> {
  return cmsRead(
    'blog.listBlogCategories',
    () =>
      prisma.blogCategory.findMany({
        where: { posts: { some: { ...publishedWhere(), locale } } },
        select: categorySelect,
        orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      }),
    [],
  )
}

const detailSelect = {
  ...listSelect,
  seoTitle: true,
  seoDescription: true,
  categoryId: true,
} as const

export type BlogPostDetail = Prisma.BlogPostGetPayload<{ select: typeof detailSelect }>

/**
 * One live post or null (missing, draft, scheduled, bad slug, table missing).
 * Wrapped in React cache: generateMetadata and the page share one query per request.
 */
export const getPublishedPost = cache(
  async (slug: string, locale: string): Promise<BlogPostDetail | null> => {
    if (!isValidSlug(slug)) return null
    return cmsRead(
      'blog.getPublishedPost',
      () =>
        prisma.blogPost.findFirst({
          where: { ...publishedWhere(), slug, locale },
          select: detailSelect,
        }),
      null,
    )
  },
)

/** Locales in which the same slug is live (for hreflang alternates). */
export const getPostLocales = cache(async (slug: string): Promise<string[]> => {
  if (!isValidSlug(slug)) return []
  const rows = await cmsRead(
    'blog.getPostLocales',
    () =>
      prisma.blogPost.findMany({
        where: { ...publishedWhere(), slug },
        select: { locale: true },
      }),
    [] as { locale: string }[],
  )
  return rows.map((r) => r.locale)
})

/** Up to `limit` other live posts of the same category and locale. */
export async function getRelatedPosts(
  post: { id: string; locale: string; categoryId: string | null },
  limit = 3,
): Promise<BlogListPost[]> {
  if (!post.categoryId) return []
  return cmsRead(
    'blog.getRelatedPosts',
    () =>
      prisma.blogPost.findMany({
        where: {
          ...publishedWhere(),
          locale: post.locale,
          categoryId: post.categoryId,
          id: { not: post.id },
        },
        select: listSelect,
        orderBy: { publishedAt: 'desc' },
        take: limit,
      }),
    [],
  )
}
