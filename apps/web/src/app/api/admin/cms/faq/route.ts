/**
 * Admin CMS FAQ.
 *   GET  ?locale=  → entries of a locale in display order (all locales without the param)
 *   POST { locale, category, question, answer, published } → new entry appended at the end
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
import { CMS_NOT_MIGRATED, isCmsTableMissing } from '@/lib/cms/safe'
import {
  CMS_FAQ_ANSWER_MAX,
  CMS_FAQ_CATEGORIES,
  CMS_FAQ_QUESTION_MAX,
  FAQ_ADMIN_SELECT as FAQ_SELECT,
  revalidateFaq,
} from '@/lib/cms/faq'

const createSchema = z
  .object({
    locale: z.enum(CMS_LOCALES),
    category: z.enum(CMS_FAQ_CATEGORIES),
    question: z.string().trim().min(1).max(CMS_FAQ_QUESTION_MAX),
    answer: z.string().trim().min(1).max(CMS_FAQ_ANSWER_MAX),
    published: z.boolean().default(false),
  })
  .strict()

function failure(error: unknown, label: string) {
  if (isCmsTableMissing(error)) return NextResponse.json(CMS_NOT_MIGRATED, { status: 503 })
  logger.error(`Admin ${label} /cms/faq error`, { error })
  return handleApiError(error)
}

async function list(request: Request) {
  const guard = await requireAdminApi()
  if (!guard.ok) return guard.response
  const locale = new URL(request.url).searchParams.get('locale')
  const parsed = z
    .enum(CMS_LOCALES)
    .optional()
    .safeParse(locale ?? undefined)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid locale' }, { status: 400 })
  try {
    const items = await prisma.cmsFaqItem.findMany({
      where: parsed.data ? { locale: parsed.data } : {},
      orderBy: [{ locale: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: FAQ_SELECT,
    })
    return NextResponse.json({ items })
  } catch (error) {
    return failure(error, 'GET')
  }
}

export const GET = withRateLimit(list, { preset: 'api', byUser: true })

export const POST = withCsrfProtection(
  withRateLimit(
    async (request: Request) => {
      const guard = await requireAdminApi()
      if (!guard.ok) return guard.response

      const parsed = createSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }

      try {
        const last = await prisma.cmsFaqItem.findFirst({
          where: { locale: parsed.data.locale },
          orderBy: { sortOrder: 'desc' },
          select: { sortOrder: true },
        })
        const item = await prisma.cmsFaqItem.create({
          data: { ...parsed.data, sortOrder: (last?.sortOrder ?? -1) + 1 },
          select: FAQ_SELECT,
        })
        await createAuditLog({
          userId: guard.session.user.id,
          action: 'CREATE',
          resource: 'CMS_FAQ',
          resourceId: item.id,
          metadata: {
            locale: item.locale,
            category: item.category,
            question: item.question,
            published: item.published,
          },
          ...getRequestMetadata(request),
        })
        revalidateFaq()
        return NextResponse.json({ item }, { status: 201 })
      } catch (error) {
        return failure(error, 'POST')
      }
    },
    { preset: 'api', byUser: true },
  ),
)
