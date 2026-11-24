/**
 * Site announcements — admin update (PATCH) and delete (DELETE). Global admins only.
 */

import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import type { Prisma } from '@prisma/client'
import { requireAdminApi } from '@/lib/admin-guard'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { handleApiError } from '@/lib/errors'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { CMS_NOT_MIGRATED, isCmsTableMissing } from '@/lib/cms/safe'
import {
  ANNOUNCEMENTS_TAG,
  announcementPatchSchema,
  isValidWindow,
} from '@/lib/cms/announcements-shared'

export const runtime = 'nodejs'

type RouteContext = { params?: Record<string, string> | Promise<Record<string, string>> }

/** Next 15 passes params as a Promise; older call sites (and the tests) pass a plain object. */
async function readId(context?: RouteContext): Promise<string | null> {
  const params = await context?.params
  const id = params?.id
  return typeof id === 'string' && id.length > 0 && id.length <= 64 ? id : null
}

type Row = {
  message: unknown
  linkUrl: string | null
  linkLabel: unknown
  variant: string
  audience: string
  startsAt: Date | null
  endsAt: Date | null
  active: boolean
  dismissible: boolean
}

/** JSON-safe snapshot of the given fields, for the audit entry. */
function snapshot(row: Row, keys: readonly (keyof Row)[]): Prisma.InputJsonValue {
  return Object.fromEntries(
    keys.map((k) => {
      const v = row[k]
      return [k, v instanceof Date ? v.toISOString() : (v ?? null)]
    }),
  ) as Prisma.InputJsonValue
}

const ALL_KEYS: readonly (keyof Row)[] = [
  'message',
  'linkUrl',
  'linkLabel',
  'variant',
  'audience',
  'startsAt',
  'endsAt',
  'active',
  'dismissible',
]

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: RouteContext) => {
      try {
        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response
        const id = await readId(context)
        if (!id) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

        const parsed = announcementPatchSchema.safeParse(await req.json().catch(() => null))
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Validation failed', issues: parsed.error.issues },
            { status: 400 },
          )
        }
        const data = parsed.data
        const changed = (Object.keys(data) as (keyof Row)[]).filter((k) => data[k] !== undefined)
        if (changed.length === 0) {
          return NextResponse.json({ error: 'Nothing to change' }, { status: 400 })
        }

        const before = await prisma.siteAnnouncement.findUnique({ where: { id } })
        if (!before) return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })

        // Checked against the merged result, so moving only one bound is validated too.
        const startsAt = data.startsAt !== undefined ? data.startsAt : before.startsAt
        const endsAt = data.endsAt !== undefined ? data.endsAt : before.endsAt
        if (!isValidWindow(startsAt, endsAt)) {
          return NextResponse.json(
            {
              error: 'Validation failed',
              issues: [{ path: ['endsAt'], message: 'endsAt must be after startsAt' }],
            },
            { status: 400 },
          )
        }

        // Labels without a link are meaningless; removing the link clears them.
        const linkUrl = data.linkUrl !== undefined ? data.linkUrl : before.linkUrl
        const linkLabel =
          linkUrl === null && (data.linkUrl !== undefined || data.linkLabel !== undefined)
            ? {}
            : data.linkLabel

        const updated = await prisma.siteAnnouncement.update({
          where: { id },
          data: {
            ...(data.message !== undefined && { message: data.message }),
            ...(data.linkUrl !== undefined && { linkUrl: data.linkUrl }),
            ...(linkLabel !== undefined && { linkLabel }),
            ...(data.variant !== undefined && { variant: data.variant }),
            ...(data.audience !== undefined && { audience: data.audience }),
            ...(data.startsAt !== undefined && { startsAt: data.startsAt }),
            ...(data.endsAt !== undefined && { endsAt: data.endsAt }),
            ...(data.active !== undefined && { active: data.active }),
            ...(data.dismissible !== undefined && { dismissible: data.dismissible }),
          },
        })

        await createAuditLog({
          userId: guard.session.user.id,
          action: 'UPDATE',
          resource: 'ANNOUNCEMENT',
          resourceId: id,
          previous: snapshot(before, changed),
          metadata: snapshot(updated, changed),
          ...getRequestMetadata(req),
        })
        revalidateTag(ANNOUNCEMENTS_TAG)
        logger.info(`Admin updated announcement ${id} by ${guard.session.user.id}`)

        return NextResponse.json({ announcement: updated })
      } catch (error) {
        if (isCmsTableMissing(error)) return NextResponse.json(CMS_NOT_MIGRATED, { status: 503 })
        logger.error('Admin PATCH /cms/announcements/[id] error', { error })
        return handleApiError(error)
      }
    },
    { preset: 'api', byUser: true },
  ),
)

/** Hard delete; the full pre-image stays in the audit log. */
export const DELETE = withCsrfProtection(
  withRateLimit(
    async (req: Request, context?: RouteContext) => {
      try {
        const guard = await requireAdminApi()
        if (!guard.ok) return guard.response
        const id = await readId(context)
        if (!id) return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })

        const before = await prisma.siteAnnouncement.findUnique({ where: { id } })
        if (!before) return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })

        await prisma.siteAnnouncement.delete({ where: { id } })

        await createAuditLog({
          userId: guard.session.user.id,
          action: 'DELETE',
          resource: 'ANNOUNCEMENT',
          resourceId: id,
          previous: snapshot(before, ALL_KEYS),
          ...getRequestMetadata(req),
        })
        revalidateTag(ANNOUNCEMENTS_TAG)
        logger.info(`Admin deleted announcement ${id} by ${guard.session.user.id}`)

        return NextResponse.json({ success: true })
      } catch (error) {
        if (isCmsTableMissing(error)) return NextResponse.json(CMS_NOT_MIGRATED, { status: 503 })
        logger.error('Admin DELETE /cms/announcements/[id] error', { error })
        return handleApiError(error)
      }
    },
    { preset: 'api', byUser: true },
  ),
)
