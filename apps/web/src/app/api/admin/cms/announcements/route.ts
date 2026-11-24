/**
 * Site announcements — admin list (GET) and create (POST). Global admins only.
 */

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { requireAdminApi } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/errors'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { CMS_NOT_MIGRATED, isCmsTableMissing } from '@/lib/cms/safe'
import { ANNOUNCEMENTS_TAG, announcementCreateSchema } from '@/lib/cms/announcements-shared'

export const runtime = 'nodejs'

const LIST_LIMIT = 200

async function listAnnouncements() {
  try {
    const guard = await requireAdminApi()
    if (!guard.ok) return guard.response

    const announcements = await prisma.siteAnnouncement.findMany({
      orderBy: { updatedAt: 'desc' },
      take: LIST_LIMIT,
    })
    return NextResponse.json({ announcements })
  } catch (error) {
    if (isCmsTableMissing(error)) return NextResponse.json(CMS_NOT_MIGRATED, { status: 503 })
    logger.error('Admin GET /cms/announcements error', { error })
    return handleApiError(error)
  }
}

export const GET = withRateLimit(listAnnouncements, { preset: 'api', byUser: true })

export const POST = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      try {
        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response

        const parsed = announcementCreateSchema.safeParse(await req.json().catch(() => null))
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Validation failed', issues: parsed.error.issues },
            { status: 400 },
          )
        }
        const data = parsed.data

        const announcement = await prisma.siteAnnouncement.create({
          data: {
            message: data.message,
            linkUrl: data.linkUrl,
            linkLabel: data.linkUrl ? data.linkLabel : {},
            variant: data.variant,
            audience: data.audience,
            startsAt: data.startsAt,
            endsAt: data.endsAt,
            active: data.active,
            dismissible: data.dismissible,
          },
        })

        await createAuditLog({
          userId: guard.session.user.id,
          action: 'CREATE',
          resource: 'ANNOUNCEMENT',
          resourceId: announcement.id,
          metadata: {
            message: data.message,
            linkUrl: data.linkUrl,
            variant: data.variant,
            audience: data.audience,
            startsAt: data.startsAt?.toISOString() ?? null,
            endsAt: data.endsAt?.toISOString() ?? null,
            active: data.active,
            dismissible: data.dismissible,
          },
          ...getRequestMetadata(req),
        })
        revalidateTag(ANNOUNCEMENTS_TAG)
        logger.info(`Admin created announcement ${announcement.id} by ${guard.session.user.id}`)

        return NextResponse.json({ announcement }, { status: 201 })
      } catch (error) {
        if (isCmsTableMissing(error)) return NextResponse.json(CMS_NOT_MIGRATED, { status: 503 })
        logger.error('Admin POST /cms/announcements error', { error })
        return handleApiError(error)
      }
    },
    { preset: 'api', byUser: true },
  ),
)
