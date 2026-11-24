/**
 * One admin blog category: rename / re-slug / re-sort (PATCH), delete (DELETE).
 * Deleting a category keeps its posts (BlogPost.categoryId is set to NULL by the FK).
 */

import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { requireAdminApi } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { updateCategorySchema } from '@/lib/blog/schemas'
import { blogApiError, revalidateBlog, routeParam, validationError } from '@/lib/blog/admin-api'

export const runtime = 'nodejs'

type RouteContext = { params?: Record<string, string> }

const CONFLICT = 'Category slug already exists'
const notFound = () => NextResponse.json({ error: 'Category not found' }, { status: 404 })
const badParams = () => NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: RouteContext) => {
      const guard = await requireAdminApi()
      if (!guard.ok) return guard.response
      const id = await routeParam(context, 'id')
      if (!id) return badParams()

      const parsed = updateCategorySchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return validationError(parsed.error)

      try {
        const existing = await prisma.blogCategory.findUnique({ where: { id } })
        if (!existing) return notFound()

        const category = await prisma.blogCategory.update({
          where: { id },
          data: parsed.data,
        })
        await createAuditLog({
          userId: guard.session.user.id,
          action: 'UPDATE',
          resource: 'BLOG_CATEGORY',
          resourceId: id,
          previous: {
            slug: existing.slug,
            names: existing.names,
            sortOrder: existing.sortOrder,
          } as Prisma.InputJsonValue,
          metadata: {
            slug: category.slug,
            names: category.names,
            sortOrder: category.sortOrder,
          } as Prisma.InputJsonValue,
          ...getRequestMetadata(req),
        })
        revalidateBlog()
        return NextResponse.json({ category })
      } catch (error) {
        return blogApiError(error, 'PATCH category', CONFLICT)
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
        const existing = await prisma.blogCategory.findUnique({
          where: { id },
          select: { id: true, slug: true, names: true },
        })
        if (!existing) return notFound()

        await prisma.blogCategory.delete({ where: { id } })
        await createAuditLog({
          userId: guard.session.user.id,
          action: 'DELETE',
          resource: 'BLOG_CATEGORY',
          resourceId: id,
          previous: { slug: existing.slug, names: existing.names } as Prisma.InputJsonValue,
          ...getRequestMetadata(req),
        })
        revalidateBlog()
        return NextResponse.json({ ok: true })
      } catch (error) {
        return blogApiError(error, 'DELETE category')
      }
    },
    { preset: 'api', byUser: true },
  ),
)
