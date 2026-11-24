/**
 * One admin blog post: read (GET), edit (PATCH), delete (DELETE). Global admins only.
 */

import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { updatePostSchema } from '@/lib/blog/schemas'
import { blogApiError, revalidateBlog, routeParam, validationError } from '@/lib/blog/admin-api'

export const runtime = 'nodejs'

type RouteContext = { params?: Record<string, string> }

const notFound = () => NextResponse.json({ error: 'Post not found' }, { status: 404 })
const badParams = () => NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

export const GET = withRateLimit(
  async (_req: Request, context?: RouteContext) => {
    const guard = await requireAdminApi()
    if (!guard.ok) return guard.response
    const id = await routeParam(context, 'id')
    if (!id) return badParams()
    try {
      const post = await prisma.blogPost.findUnique({ where: { id } })
      if (!post) return notFound()
      return NextResponse.json({ post })
    } catch (error) {
      return blogApiError(error, 'GET post')
    }
  },
  { preset: 'api', byUser: true },
)

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: RouteContext) => {
      const guard = await requireAdminApi()
      if (!guard.ok) return guard.response
      const id = await routeParam(context, 'id')
      if (!id) return badParams()

      const parsed = updatePostSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return validationError(parsed.error)
      const { publishedAt: publishedAtInput, ...data } = parsed.data

      try {
        const existing = await prisma.blogPost.findUnique({ where: { id } })
        if (!existing) return notFound()

        if (data.categoryId) {
          const category = await prisma.blogCategory.findUnique({
            where: { id: data.categoryId },
            select: { id: true },
          })
          if (!category) {
            return NextResponse.json({ error: 'Category not found' }, { status: 400 })
          }
        }

        // Merge the date with the stored one; publishing with no date means "now".
        const status = data.status ?? existing.status
        let publishedAt =
          publishedAtInput === undefined
            ? existing.publishedAt
            : publishedAtInput === null
              ? null
              : new Date(publishedAtInput)
        if (status === 'PUBLISHED' && !publishedAt) publishedAt = new Date()

        const post = await prisma.blogPost.update({
          where: { id },
          data: {
            ...data,
            status,
            publishedAt,
            ...(existing.authorId ? {} : { authorId: guard.session.user.id }),
          },
        })

        const changedFields = Object.keys(parsed.data)
        await createAuditLog({
          userId: guard.session.user.id,
          action: 'UPDATE',
          resource: 'BLOG_POST',
          resourceId: id,
          previous: {
            slug: existing.slug,
            locale: existing.locale,
            status: existing.status,
            publishedAt: existing.publishedAt?.toISOString() ?? null,
          },
          metadata: {
            slug: post.slug,
            locale: post.locale,
            status: post.status,
            publishedAt: post.publishedAt?.toISOString() ?? null,
            changedFields,
          },
          ...getRequestMetadata(req),
        })
        revalidateBlog([
          `/${existing.locale}/blog/${existing.slug}`,
          `/${post.locale}/blog/${post.slug}`,
        ])

        return NextResponse.json({ post })
      } catch (error) {
        return blogApiError(error, 'PATCH post')
      }
    },
    { preset: 'api', byUser: true },
  ),
)

export const DELETE = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: RouteContext) => {
      const guard = await requireAdminApi()
      if (!guard.ok) return guard.response
      const id = await routeParam(context, 'id')
      if (!id) return badParams()

      try {
        const existing = await prisma.blogPost.findUnique({
          where: { id },
          select: { id: true, slug: true, locale: true, title: true, status: true },
        })
        if (!existing) return notFound()

        await prisma.blogPost.delete({ where: { id } })

        await createAuditLog({
          userId: guard.session.user.id,
          action: 'DELETE',
          resource: 'BLOG_POST',
          resourceId: id,
          previous: {
            slug: existing.slug,
            locale: existing.locale,
            title: existing.title,
            status: existing.status,
          },
          ...getRequestMetadata(req),
        })
        revalidateBlog([`/${existing.locale}/blog/${existing.slug}`])

        return NextResponse.json({ ok: true })
      } catch (error) {
        return blogApiError(error, 'DELETE post')
      }
    },
    { preset: 'api', byUser: true },
  ),
)
