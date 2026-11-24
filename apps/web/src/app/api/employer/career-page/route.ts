/**
 * Employer career page (one per organization, public at /[locale]/careers/[org.slug]).
 * GET: any active member of a non-suspended org (returns defaults when nothing is saved).
 * PUT: ORG_ADMIN only — upsert. The org always comes from the session, never the body.
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { CMS_NOT_MIGRATED, isCmsTableMissing } from '@/lib/cms/safe'
import { CMS_LOCALES } from '@/lib/cms/constants'
import { resolveCareerEmployer } from '@/lib/career/employer-context'
import { careerPagePath } from '@/lib/career/media'
import {
  CAREER_PAGE_DEFAULTS,
  careerPageInputSchema,
  pickCareerFields,
  type CareerPageFields,
} from '@/lib/career/schema'

function revalidatePublicPages(slug: string, orgId: string) {
  for (const locale of CMS_LOCALES) {
    try {
      revalidatePath(careerPagePath(locale, slug))
      revalidatePath(`/${locale}/company/${orgId}`)
    } catch (error) {
      logger.warn('Career page revalidation failed', { error })
    }
  }
}

export const GET = withRateLimit(
  async () => {
    const resolved = await resolveCareerEmployer({ requireAdmin: false })
    if (!resolved.ok) return resolved.response
    const { orgId, slug, canEdit } = resolved.ctx
    try {
      const page = await prisma.careerPage.findUnique({ where: { orgId } })
      return NextResponse.json({
        page: page ? pickCareerFields(page) : CAREER_PAGE_DEFAULTS,
        exists: Boolean(page),
        canEdit,
        slug,
      })
    } catch (error) {
      if (isCmsTableMissing(error)) return NextResponse.json(CMS_NOT_MIGRATED, { status: 503 })
      logger.error('Career page load failed', { error })
      return NextResponse.json({ error: 'Failed to load career page' }, { status: 500 })
    }
  },
  { preset: 'api', byUser: true },
)

export const PUT = withCsrfProtection(
  withRateLimit(
    async (request: Request) => {
      const resolved = await resolveCareerEmployer({ requireAdmin: true })
      if (!resolved.ok) return resolved.response
      const { orgId, slug, userId } = resolved.ctx

      const body = await request.json().catch(() => null)
      if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
      }
      const parsed = careerPageInputSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
          { status: 400 },
        )
      }

      // Only keys that were sent are written; `undefined` keeps the stored value.
      const data = Object.fromEntries(
        Object.entries(parsed.data).filter(([, v]) => v !== undefined),
      ) as Partial<CareerPageFields>

      try {
        const previous = await prisma.careerPage.findUnique({ where: { orgId } })
        const page = await prisma.careerPage.upsert({
          where: { orgId },
          create: { ...CAREER_PAGE_DEFAULTS, ...data, orgId },
          update: data,
        })

        await createAuditLog({
          userId,
          orgId,
          action: previous ? 'UPDATE' : 'CREATE',
          resource: 'CAREER_PAGE',
          resourceId: page.id,
          metadata: { ...pickCareerFields(page) },
          previous: previous ? { ...pickCareerFields(previous) } : undefined,
          ...getRequestMetadata(request),
        })

        revalidatePublicPages(slug, orgId)

        return NextResponse.json({ page: pickCareerFields(page), exists: true, slug })
      } catch (error) {
        if (isCmsTableMissing(error)) return NextResponse.json(CMS_NOT_MIGRATED, { status: 503 })
        logger.error('Career page save failed', { error })
        return NextResponse.json({ error: 'Failed to save career page' }, { status: 500 })
      }
    },
    { preset: 'api', byUser: true },
  ),
)
