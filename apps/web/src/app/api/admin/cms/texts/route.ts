/**
 * Admin overrides of whitelisted site texts (lib/cms/texts.ts CMS_TEXT_KEYS).
 *   GET    ?locale=          → overrides (all locales without the param)
 *   PUT    { key, locale, value } → set the override (plain text, max 500 chars)
 *   DELETE ?key=&locale=     → reset to the built-in text (idempotent)
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
import { CMS_TEXT_KEYS, CMS_TEXT_MAX_LENGTH, revalidateCmsText } from '@/lib/cms/texts'

// Plain text only: no tags and no control characters other than newline / tab.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const HTML_TAG = /<\/?[a-z!][^>]*>/i

const keySchema = z.object({
  key: z.enum(CMS_TEXT_KEYS),
  locale: z.enum(CMS_LOCALES),
})

const putSchema = keySchema
  .extend({
    value: z
      .string()
      .trim()
      .min(1)
      .max(CMS_TEXT_MAX_LENGTH)
      .refine((v) => !HTML_TAG.test(v), 'HTML is not allowed')
      .refine((v) => !CONTROL_CHARS.test(v), 'Control characters are not allowed'),
  })
  .strict()

function failure(error: unknown, label: string) {
  if (isCmsTableMissing(error)) return NextResponse.json(CMS_NOT_MIGRATED, { status: 503 })
  logger.error(`Admin ${label} /cms/texts error`, { error })
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
    const texts = await prisma.cmsText.findMany({
      where: parsed.data ? { locale: parsed.data } : {},
      select: { key: true, locale: true, value: true, updatedAt: true },
      orderBy: [{ locale: 'asc' }, { key: 'asc' }],
    })
    return NextResponse.json({ texts })
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

      const parsed = putSchema.safeParse(await request.json().catch(() => null))
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid input', issues: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }
      const { key, locale, value } = parsed.data

      try {
        const before = await prisma.cmsText.findUnique({
          where: { key_locale: { key, locale } },
          select: { id: true, value: true },
        })
        const text = await prisma.cmsText.upsert({
          where: { key_locale: { key, locale } },
          create: { key, locale, value, updatedById: guard.session.user.id },
          update: { value, updatedById: guard.session.user.id },
          select: { id: true, key: true, locale: true, value: true, updatedAt: true },
        })
        await createAuditLog({
          userId: guard.session.user.id,
          action: before ? 'UPDATE' : 'CREATE',
          resource: 'CMS_TEXT',
          resourceId: text.id,
          metadata: { key, locale, value },
          ...(before ? { previous: { value: before.value } } : {}),
          ...getRequestMetadata(request),
        })
        revalidateCmsText(key)
        return NextResponse.json({ text }, { status: before ? 200 : 201 })
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
        key: searchParams.get('key'),
        locale: searchParams.get('locale'),
      })
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid key or locale' }, { status: 400 })
      }
      const { key, locale } = parsed.data

      try {
        const before = await prisma.cmsText.findUnique({
          where: { key_locale: { key, locale } },
          select: { id: true, value: true },
        })
        if (before) {
          await prisma.cmsText.delete({ where: { key_locale: { key, locale } } })
          await createAuditLog({
            userId: guard.session.user.id,
            action: 'DELETE',
            resource: 'CMS_TEXT',
            resourceId: before.id,
            previous: { key, locale, value: before.value },
            ...getRequestMetadata(request),
          })
          revalidateCmsText(key)
        }
        return NextResponse.json({ success: true, reset: Boolean(before) })
      } catch (error) {
        return failure(error, 'DELETE')
      }
    },
    { preset: 'api', byUser: true },
  ),
)
