/**
 * Admin CMS FAQ entry.
 *   PATCH  { category?, question?, answer?, published? }
 *   DELETE → hard delete (pre-image kept in the audit log)
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
import { CMS_NOT_MIGRATED, isCmsTableMissing } from '@/lib/cms/safe'
import {
  CMS_FAQ_ANSWER_MAX,
  CMS_FAQ_CATEGORIES,
  CMS_FAQ_QUESTION_MAX,
  FAQ_ADMIN_SELECT,
  revalidateFaq,
} from '@/lib/cms/faq'

type Context = { params?: Record<string, string> }

const idSchema = z.string().min(1).max(64)

const patchSchema = z
  .object({
    category: z.enum(CMS_FAQ_CATEGORIES).optional(),
    question: z.string().trim().min(1).max(CMS_FAQ_QUESTION_MAX).optional(),
    answer: z.string().trim().min(1).max(CMS_FAQ_ANSWER_MAX).optional(),
    published: z.boolean().optional(),
  })
  .strict()

/** Next 15 passes params as a Promise; awaiting also accepts a plain object. */
async function readId(context?: Context): Promise<string | null> {
  const params = await context?.params
  const parsed = idSchema.safeParse(params?.id)
  return parsed.success ? parsed.data : null
}

function failure(error: unknown, label: string) {
  if (isCmsTableMissing(error)) return NextResponse.json(CMS_NOT_MIGRATED, { status: 503 })
  logger.error(`Admin ${label} /cms/faq/[id] error`, { error })
  return handleApiError(error)
}

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (request: Request, context?: Context) => {
      const guard = await requireAdminApi()
      if (!guard.ok) return guard.response
      const id = await readId(context)
      if (!id) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

      const parsed = patchSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }
      const changed = Object.keys(parsed.data) as Array<keyof typeof parsed.data>
      if (changed.length === 0) {
        return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
      }

      try {
        const before = await prisma.cmsFaqItem.findUnique({
          where: { id },
          select: FAQ_ADMIN_SELECT,
        })
        if (!before) return NextResponse.json({ error: 'FAQ item not found' }, { status: 404 })

        const item = await prisma.cmsFaqItem.update({
          where: { id },
          data: parsed.data,
          select: FAQ_ADMIN_SELECT,
        })
        const pick = (o: Record<string, unknown>) =>
          Object.fromEntries(changed.map((k) => [k, o[k] ?? null]))
        await createAuditLog({
          userId: guard.session.user.id,
          action: 'UPDATE',
          resource: 'CMS_FAQ',
          resourceId: id,
          previous: pick(before) as never,
          metadata: { locale: item.locale, ...pick(item) } as never,
          ...getRequestMetadata(request),
        })
        revalidateFaq()
        return NextResponse.json({ item })
      } catch (error) {
        return failure(error, 'PATCH')
      }
    },
    { preset: 'api', byUser: true },
  ),
)

export const DELETE = withCsrfProtection(
  withRateLimit(
    async (request: Request, context?: Context) => {
      const guard = await requireAdminApi()
      if (!guard.ok) return guard.response
      const id = await readId(context)
      if (!id) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

      try {
        const before = await prisma.cmsFaqItem.findUnique({
          where: { id },
          select: FAQ_ADMIN_SELECT,
        })
        if (!before) return NextResponse.json({ error: 'FAQ item not found' }, { status: 404 })

        await prisma.cmsFaqItem.delete({ where: { id } })
        await createAuditLog({
          userId: guard.session.user.id,
          action: 'DELETE',
          resource: 'CMS_FAQ',
          resourceId: id,
          previous: {
            locale: before.locale,
            category: before.category,
            question: before.question,
            answer: before.answer,
            published: before.published,
          },
          ...getRequestMetadata(request),
        })
        revalidateFaq()
        return NextResponse.json({ success: true })
      } catch (error) {
        return failure(error, 'DELETE')
      }
    },
    { preset: 'api', byUser: true },
  ),
)
