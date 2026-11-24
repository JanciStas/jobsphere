/**
 * Site announcements — server side: the cached public loader.
 * Validation, selection and time helpers live in `announcements-shared.ts` (client-safe)
 * and are re-exported here.
 */

import { unstable_cache } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { cmsRead } from './safe'
import {
  ANNOUNCEMENTS_TAG,
  selectAnnouncements,
  type AnnouncementRow,
  type PublicAnnouncement,
} from './announcements-shared'

export * from './announcements-shared'

/** Upper bound of active rows read for the bar; more than a handful is an editorial mistake. */
const ACTIVE_ROWS_LIMIT = 20

/** Serializable shape: unstable_cache round-trips through JSON, so dates travel as ISO strings. */
type CachedRow = Omit<AnnouncementRow, 'startsAt' | 'endsAt' | 'updatedAt'> & {
  startsAt: string | null
  endsAt: string | null
  updatedAt: string
}

/** Uncached read of every active row. Never throws: a missing table (or any DB error) → []. */
export async function readActiveAnnouncementRows(): Promise<CachedRow[]> {
  return cmsRead(
    'announcements.active',
    async () => {
      const rows = await prisma.siteAnnouncement.findMany({
        where: { active: true },
        orderBy: { updatedAt: 'desc' },
        take: ACTIVE_ROWS_LIMIT,
      })
      return rows.map((r) => ({
        id: r.id,
        message: r.message,
        linkUrl: r.linkUrl,
        linkLabel: r.linkLabel,
        variant: r.variant,
        audience: r.audience,
        startsAt: r.startsAt?.toISOString() ?? null,
        endsAt: r.endsAt?.toISOString() ?? null,
        active: r.active,
        dismissible: r.dismissible,
        updatedAt: r.updatedAt.toISOString(),
      }))
    },
    [],
  )
}

/**
 * Active rows, cached for 60 s and invalidated by `revalidateTag('announcements')`.
 * The time window is applied after the cache, so a cached row still expires on time.
 */
const cachedActiveRows = unstable_cache(readActiveAnnouncementRows, ['cms-announcements-active'], {
  tags: [ANNOUNCEMENTS_TAG],
  revalidate: 60,
})

/**
 * Announcements visible now in `locale`, before audience filtering (the root layout must
 * not read the session, so the client bar filters by audience). Never throws.
 */
export async function getActiveAnnouncements(
  locale: string,
  now: Date = new Date(),
): Promise<PublicAnnouncement[]> {
  try {
    const rows = await cachedActiveRows()
    return selectAnnouncements(rows, { now, locale })
  } catch {
    // unstable_cache itself failing (e.g. outside a request scope) must not break the layout.
    return selectAnnouncements(await readActiveAnnouncementRows(), { now, locale })
  }
}
