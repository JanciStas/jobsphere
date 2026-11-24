import { getActiveAnnouncements } from '@/lib/cms/announcements'
import { AnnouncementBarClient } from './announcement-bar-client'

/**
 * Site-wide announcement banner above the header.
 *
 * Rendered from the root layout, so it must stay static-friendly: no auth()/cookies()/
 * headers() here. The server resolves the time window and locale (cached, tag
 * `announcements`); the client child filters by audience and handles dismissal.
 * Renders nothing — and never throws — when the CMS table does not exist yet.
 */
export async function AnnouncementBar({ locale }: { locale: string }) {
  let items: Awaited<ReturnType<typeof getActiveAnnouncements>> = []
  try {
    items = await getActiveAnnouncements(locale)
  } catch {
    items = []
  }
  if (items.length === 0) return null
  return <AnnouncementBarClient items={items} />
}
