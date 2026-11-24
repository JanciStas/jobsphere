/**
 * Admin blog categories: list (GET), create (POST), reorder (PUT { order: id[] }).
 * Global admins only.
 */

import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { createCategorySchema, reorderCategoriesSchema } from '@/lib/blog/schemas'
import { blogApiError, revalidateBlog, validationError } from '@/lib/blog/admin-api'

export const runtime = 'nodejs'

const CONFLICT = 'Category slug already exists'

export const GET = withRateLimit(
  async () => {
    const guard = await requireAdminApi()
    if (!guard.ok) return guard.response
    try {
      const categories = await prisma.blogCategory.findMany({
        orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
        include: { _count: { select: { posts: true } } },
      })
      return NextResponse.json({ categories })
    } catch (error) {
      return blogApiError(error, 'GET categories')
    }
  },
  { preset: 'api', byUser: true },
)

export const POST = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      const guard = await requireAdminApi()
      if (!guard.ok) return guard.response

      const parsed = createCategorySchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return validationError(parsed.error)

      try {
        let sortOrder = parsed.data.sortOrder
        if (sortOrder === undefined) {
          const last = await prisma.blogCategory.findFirst({
            orderBy: { sortOrder: 'desc' },
            select: { sortOrder: true },
          })
          sortOrder = last ? last.sortOrder + 1 : 0
        }
        const category = await prisma.blogCategory.create({
          data: { slug: parsed.data.slug, names: parsed.data.names, sortOrder },
        })
        await createAuditLog({
          userId: guard.session.user.id,
          action: 'CREATE',
          resource: 'BLOG_CATEGORY',
          resourceId: category.id,
          metadata: { slug: category.slug, names: parsed.data.names },
          ...getRequestMetadata(req),
        })
        revalidateBlog()
        return NextResponse.json({ category }, { status: 201 })
      } catch (error) {
        return blogApiError(error, 'POST category', CONFLICT)
      }
    },
    { preset: 'api', byUser: true },
  ),
)

export const PUT = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      const guard = await requireAdminApi()
      if (!guard.ok) return guard.response

      const parsed = reorderCategoriesSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return validationError(parsed.error)
      const { order } = parsed.data

      try {
        const existing = await prisma.blogCategory.findMany({
          where: { id: { in: order } },
          select: { id: true },
        })
        if (existing.length !== order.length) {
          return NextResponse.json({ error: 'Category not found' }, { status: 400 })
        }
        await prisma.$transaction(
          order.map((id, index) =>
            prisma.blogCategory.update({ where: { id }, data: { sortOrder: index } }),
          ),
        )
        await createAuditLog({
          userId: guard.session.user.id,
          action: 'UPDATE',
          resource: 'BLOG_CATEGORY',
          metadata: { reordered: order },
          ...getRequestMetadata(req),
        })
        revalidateBlog()
        return NextResponse.json({ ok: true })
      } catch (error) {
        return blogApiError(error, 'PUT categories order', CONFLICT)
      }
    },
    { preset: 'api', byUser: true },
  ),
)
