/**
 * Admin CMS static pages (terms, privacy, gdpr, about), one row per slug + locale.
 *   GET    → all versions (without body)
 *   PUT    → upsert { slug, locale, title, body, seoTitle?, seoDescription?, status }
 *   DELETE ?slug=&locale= → remove that version (public page falls back to built-in text)
 * Global admins only.
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/errors'
import { requireAdminApi } from '@/lib/admin-guard'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { CMS_LOCALES } from '@/lib/cms/constants'
import { MAX_MARKDOWN_LENGTH } from '@/lib/cms/markdown'
import { CMS_NOT_MIGRATED, isCmsTableMissing } from '@/lib/cms/safe'
import {
  CMS_PAGE_SLUGS,
  CMS_PAGE_SEO_DESCRIPTION_MAX,
  CMS_PAGE_SEO_TITLE_MAX,
  CMS_PAGE_TITLE_MAX,
  revalidateCmsPage,
} from '@/lib/cms/pages'

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null))

const upsertSchema = z
  .object({
    slug: z.enum(CMS_PAGE_SLUGS),
    locale: z.enum(CMS_LOCALES),
    title: z.string().trim().min(1).max(CMS_PAGE_TITLE_MAX),
    body: z.string().trim().min(1).max(MAX_MARKDOWN_LENGTH),
    seoTitle: optionalText(CMS_PAGE_SEO_TITLE_MAX),
    seoDescription: optionalText(CMS_PAGE_SEO_DESCRIPTION_MAX),
    status: z.enum(['DRAFT', 'PUBLISHED']),
  })
  .strict()

const keySchema = z.object({
  slug: z.enum(CMS_PAGE_SLUGS),
  locale: z.enum(CMS_LOCALES),
})

const SUMMARY_SELECT = {
  id: true,
  slug: true,
  locale: true,
  title: true,
  status: true,
  publishedAt: true,
  updatedAt: true,
} as const

function failure(error: unknown, label: string) {
  if (isCmsTableMissing(error)) return NextResponse.json(CMS_NOT_MIGRATED, { status: 503 })
  logger.error(`Admin ${label} /cms/pages error`, { error })
  return handleApiError(error)
}

async function list() {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response
  try {
    const pages = await prisma.cmsPage.findMany({
      select: SUMMARY_SELECT,
      orderBy: [{ slug: 'asc' }, { locale: 'asc' }],
    })
    return NextResponse.json({ pages })
  } catch (error) {
    return failure(error, 'GET')
  }
}

export const GET = withRateLimit(list, { preset: 'api', byUser: true })

export const PUT = withCsrfProtection(
  withRateLimit(
    async (request: Request) => {
      const guard = await requireAdminApi()
      if (!guard.ok) return guard.response

      const parsed = upsertSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }
      const { slug, locale, status, ...content } = parsed.data

      try {
        const before = await prisma.cmsPage.findUnique({
          where: { slug_locale: { slug, locale } },
          select: { ...SUMMARY_SELECT, seoTitle: true, seoDescription: true },
        })
        // publishedAt marks the first publication and is kept afterwards.
        const publishedAt = before?.publishedAt ?? (status === 'PUBLISHED' ? new Date() : null)

        const page = await prisma.cmsPage.upsert({
          where: { slug_locale: { slug, locale } },
          create: {
            slug,
            locale,
            status,
            publishedAt,
            updatedById: guard.session.user.id,
            ...content,
          },
          update: { status, publishedAt, updatedById: guard.session.user.id, ...content },
          select: SUMMARY_SELECT,
        })

        await createAuditLog({
          userId: guard.session.user.id,
          action: before ? 'UPDATE' : 'CREATE',
          resource: 'CMS_PAGE',
          resourceId: page.id,
          metadata: { slug, locale, title: page.title, status: page.status },
          ...(before
            ? {
                previous: {
                  title: before.title,
                  status: before.status,
                  seoTitle: before.seoTitle,
                  seoDescription: before.seoDescription,
                },
              }
            : {}),
          ...getRequestMetadata(request),
        })
        revalidateCmsPage(slug)
        return NextResponse.json({ page }, { status: before ? 200 : 201 })
      } catch (error) {
        return failure(error, 'PUT')
      }
    },
    { preset: 'api', byUser: true },
  ),
)

export const DELETE = withCsrfProtection(
  withRateLimit(
    async (request: Request) => {
      const guard = await requireAdminApi()
      if (!guard.ok) return guard.response

      const { searchParams } = new URL(request.url)
      const parsed = keySchema.safeParse({
        slug: searchParams.get('slug'),
        locale: searchParams.get('locale'),
      })
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid slug or locale' }, { status: 400 })
      }
      const { slug, locale } = parsed.data

      try {
        const before = await prisma.cmsPage.findUnique({
          where: { slug_locale: { slug, locale } },
          select: SUMMARY_SELECT,
        })
        if (!before) return NextResponse.json({ error: 'Page not found' }, { status: 404 })

        await prisma.cmsPage.delete({ where: { slug_locale: { slug, locale } } })
        await createAuditLog({
          userId: guard.session.user.id,
          action: 'DELETE',
          resource: 'CMS_PAGE',
          resourceId: before.id,
          previous: { slug, locale, title: before.title, status: before.status },
          ...getRequestMetadata(request),
        })
        revalidateCmsPage(slug)
        return NextResponse.json({ success: true })
      } catch (error) {
        return failure(error, 'DELETE')
      }
    },
    { preset: 'api', byUser: true },
  ),
)
