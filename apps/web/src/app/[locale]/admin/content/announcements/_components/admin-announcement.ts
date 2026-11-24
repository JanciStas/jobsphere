/** Serializable announcement passed from admin server pages to client components. */

import type { AnnouncementAudience, AnnouncementVariant } from '@/lib/cms/announcements-shared'

export interface AdminAnnouncement {
  id: string
  message: Record<string, string>
  linkUrl: string | null
  linkLabel: Record<string, string>
  variant: AnnouncementVariant
  audience: AnnouncementAudience
  startsAt: string | null
  endsAt: string | null
  active: boolean
  dismissible: boolean
  updatedAt: string
}

/** Load state of an admin page that reads the announcements table. */
export type AnnouncementsLoadState = 'ok' | 'missing' | 'error'

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  )
}

export function toAdminAnnouncement(row: {
  id: string
  message: unknown
  linkUrl: string | null
  linkLabel: unknown
  variant: string
  audience: string
  startsAt: Date | null
  endsAt: Date | null
  active: boolean
  dismissible: boolean
  updatedAt: Date
}): AdminAnnouncement {
  return {
    id: row.id,
    message: stringMap(row.message),
    linkUrl: row.linkUrl,
    linkLabel: stringMap(row.linkLabel),
    variant: row.variant as AnnouncementVariant,
    audience: row.audience as AnnouncementAudience,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    active: row.active,
    dismissible: row.dismissible,
    updatedAt: row.updatedAt.toISOString(),
  }
}
