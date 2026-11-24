/**
 * Admin blog posts: list (GET) and create (POST). Global admins only.
 * A PUBLISHED post with a future publishedAt is scheduled; publishing without a date
 * publishes now.
 */

import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { requireAdminApi, parsePaging } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { isCmsLocale } from '@/lib/cms/constants'
import { createPostSchema } from '@/lib/blog/schemas'
import { blogApiError, revalidateBlog, validationError } from '@/lib/blog/admin-api'

export const runtime = 'nodejs'

const listSelect = {
  id: true,
  slug: true,
  locale: true,
  title: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
  categoryId: true,
} as const

async function listPosts(req: Request) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response
  try {
    const { searchParams } = new URL(req.url)
    const { page, limit, skip } = parsePaging(searchParams, 50)
    const locale = searchParams.get('locale')
    const status = searchParams.get('status')
    const now = new Date()

    const where: Prisma.BlogPostWhereInput = {
      ...(isCmsLocale(locale) ? { locale } : {}),
      ...(status === 'DRAFT' ? { status: 'DRAFT' } : {}),
      ...(status === 'PUBLISHED' ? { status: 'PUBLISHED', publishedAt: { lte: now } } : {}),
      ...(status === 'SCHEDULED' ? { status: 'PUBLISHED', publishedAt: { gt: now } } : {}),
    }

    const [posts, total] = await Promise.all([
      prisma.blogPost.findMany({
        where,
        select: listSelect,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.blogPost.count({ where }),
    ])
    return NextResponse.json({ posts, total, page, limit })
  } catch (error) {
    return blogApiError(error, 'GET posts')
  }
}

export const GET = withRateLimit(listPosts, { preset: 'api', byUser: true })

export const POST = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      const guard = await requireAdminApi()
      if (!guard.ok) return guard.response

      const parsed = createPostSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return validationError(parsed.error)
      const data = parsed.data

      try {
        if (data.categoryId) {
          const category = await prisma.blogCategory.findUnique({
            where: { id: data.categoryId },
            select: { id: true },
          })
          if (!category) {
            return NextResponse.json({ error: 'Category not found' }, { status: 400 })
          }
        }

        const status = data.status ?? 'DRAFT'
        const publishedAt = data.publishedAt
          ? new Date(data.publishedAt)
          : status === 'PUBLISHED'
            ? new Date()
            : null

        const post = await prisma.blogPost.create({
          data: {
            locale: data.locale,
            slug: data.slug,
            title: data.title,
            excerpt: data.excerpt ?? null,
            body: data.body,
            coverImage: data.coverImage ?? null,
            categoryId: data.categoryId ?? null,
            tags: data.tags ?? [],
            seoTitle: data.seoTitle ?? null,
            seoDescription: data.seoDescription ?? null,
            status,
            publishedAt,
            authorId: guard.session.user.id,
          },
          select: { ...listSelect },
        })

        await createAuditLog({
          userId: guard.session.user.id,
          action: 'CREATE',
          resource: 'BLOG_POST',
          resourceId: post.id,
          metadata: {
            slug: post.slug,
            locale: post.locale,
            status: post.status,
            publishedAt: post.publishedAt?.toISOString() ?? null,
          },
          ...getRequestMetadata(req),
        })
        revalidateBlog([`/${post.locale}/blog/${post.slug}`])

        return NextResponse.json({ post }, { status: 201 })
      } catch (error) {
        return blogApiError(error, 'POST posts')
      }
    },
    { preset: 'api', byUser: true },
  ),
)
