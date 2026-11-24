/**
 * Site announcements: validation, selection and Slovak-time helpers.
 * Pure module (no Prisma, no Next server APIs): safe to import from client components.
 */

import { z } from 'zod'
import { CMS_LOCALES, isSafeCmsLink, type CmsLocale } from './constants'

export const ANNOUNCEMENT_VARIANTS = ['info', 'warning', 'promo'] as const
export type AnnouncementVariant = (typeof ANNOUNCEMENT_VARIANTS)[number]

export const ANNOUNCEMENT_AUDIENCES = ['all', 'candidates', 'employers', 'guests'] as const
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number]

/** Who is looking at the page (derived from the session on the client). */
export type AnnouncementViewer = 'guest' | 'candidate' | 'employer'

export const ANNOUNCEMENT_MESSAGE_MAX = 300
export const ANNOUNCEMENT_LABEL_MAX = 60
export const ANNOUNCEMENT_LINK_MAX = 2000
/** The bar never shows more than this many announcements at once. */
export const ANNOUNCEMENT_MAX_VISIBLE = 2
/** Cache tag revalidated after every admin write. */
export const ANNOUNCEMENTS_TAG = 'announcements'
/** Admins enter and read schedule times in Slovak time. */
export const ANNOUNCEMENT_TIME_ZONE = 'Europe/Bratislava'

// ---------------------------------------------------------------------------
// Slovak time <-> UTC (DST aware, same two-pass approach as the audit filters)
// ---------------------------------------------------------------------------

const zoneParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: ANNOUNCEMENT_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function wallClock(d: Date): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of zoneParts.formatToParts(d))
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  return out
}

function zoneOffsetMs(t: number): number {
  const w = wallClock(new Date(t))
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - (t - (t % 1000))
}

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/

/** `YYYY-MM-DDTHH:mm` (a datetime-local value) in Slovak time → UTC instant; null if invalid. */
export function bratislavaLocalToDate(value: string): Date | null {
  const m = LOCAL_DATETIME.exec(value)
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0))
  const naive = Date.UTC(y, mo - 1, d, h, mi, s)
  const check = new Date(naive)
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== mi
  ) {
    return null
  }
  let t = naive - zoneOffsetMs(naive)
  t = naive - zoneOffsetMs(t)
  return new Date(t)
}

/** UTC instant → `YYYY-MM-DDTHH:mm` in Slovak time (value for an `<input type="datetime-local">`). */
export function dateToBratislavaLocal(date: Date | string): string {
  const w = wallClock(typeof date === 'string' ? new Date(date) : date)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${w.year}-${p(w.month)}-${p(w.day)}T${p(w.hour)}:${p(w.minute)}`
}

// ---------------------------------------------------------------------------
// Validation (admin API)
// ---------------------------------------------------------------------------

/** Per-locale text map; empty strings are dropped so they never shadow the fallback. */
function localizedMap(max: number, requireSk: boolean) {
  const shape = {} as Record<CmsLocale, z.ZodTypeAny>
  for (const l of CMS_LOCALES) {
    shape[l] =
      requireSk && l === 'sk'
        ? z.string().trim().min(1).max(max)
        : z.string().trim().max(max).optional()
  }
  return z
    .object(shape)
    .strict()
    .transform((map) => {
      const out: Partial<Record<CmsLocale, string>> = {}
      for (const l of CMS_LOCALES) {
        const v = (map as Record<string, string | undefined>)[l]
        if (v) out[l] = v
      }
      return out
    })
}

const emptyToNull = (v: unknown) => (v === '' || v === undefined ? null : v)

const linkUrlSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .max(ANNOUNCEMENT_LINK_MAX)
    .refine(isSafeCmsLink, { message: 'Link must be an http(s) URL or a site path' })
    .nullable(),
)

/** Accepts a datetime-local value (Slovak time), an ISO instant with zone, or null/''. */
const scheduleDateSchema = z.preprocess(
  emptyToNull,
  z
    .string()
    .trim()
    .transform((value, ctx) => {
      const local = bratislavaLocalToDate(value)
      if (local) return local
      if (/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
        const d = new Date(value)
        if (!Number.isNaN(d.getTime())) return d
      }
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date' })
      return z.NEVER
    })
    .nullable(),
)

const announcementFields = {
  message: localizedMap(ANNOUNCEMENT_MESSAGE_MAX, true),
  linkUrl: linkUrlSchema,
  linkLabel: localizedMap(ANNOUNCEMENT_LABEL_MAX, false),
  variant: z.enum(ANNOUNCEMENT_VARIANTS),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES),
  startsAt: scheduleDateSchema,
  endsAt: scheduleDateSchema,
  active: z.boolean(),
  dismissible: z.boolean(),
}

/** True when the window is open-ended or ends strictly after it starts. */
export function isValidWindow(startsAt: Date | null, endsAt: Date | null): boolean {
  return !startsAt || !endsAt || endsAt.getTime() > startsAt.getTime()
}

const windowIssue = { message: 'endsAt must be after startsAt', path: ['endsAt'] }

/** Body of POST /api/admin/cms/announcements. */
export const announcementCreateSchema = z
  .object({
    ...announcementFields,
    linkUrl: announcementFields.linkUrl.default(null),
    linkLabel: announcementFields.linkLabel.default({}),
    variant: announcementFields.variant.default('info'),
    audience: announcementFields.audience.default('all'),
    startsAt: announcementFields.startsAt.default(null),
    endsAt: announcementFields.endsAt.default(null),
    active: announcementFields.active.default(false),
    dismissible: announcementFields.dismissible.default(true),
  })
  .strict()
  .refine((d) => isValidWindow(d.startsAt, d.endsAt), windowIssue)

/** Body of PATCH /api/admin/cms/announcements/[id]; the window is checked against the merged row. */
export const announcementPatchSchema = z.object(announcementFields).partial().strict()

export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>
export type AnnouncementPatchInput = z.infer<typeof announcementPatchSchema>

// ---------------------------------------------------------------------------
// Selection (public bar)
// ---------------------------------------------------------------------------

/** A stored announcement as read from the DB or from the JSON-serialized cache. */
export interface AnnouncementRow {
  id: string
  message: unknown
  linkUrl: string | null
  linkLabel: unknown
  variant: string
  audience: string
  startsAt: Date | string | null
  endsAt: Date | string | null
  active: boolean
  dismissible: boolean
  updatedAt: Date | string
}

/** What the bar renders: text already resolved for one locale. */
export interface PublicAnnouncement {
  id: string
  /** Changes on every edit, so an edited announcement shows again after dismissal. */
  version: string
  message: string
  linkUrl: string | null
  linkLabel: string | null
  variant: AnnouncementVariant
  audience: AnnouncementAudience
  dismissible: boolean
  endsAt: string | null
}

const toDate = (v: Date | string | null): Date | null => {
  if (v === null || v === undefined) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Text for `locale`, falling back to sk → en → first non-empty locale. */
export function resolveLocalized(map: unknown, locale: string): string | null {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null
  const m = map as Record<string, unknown>
  const pick = (l: string) => (typeof m[l] === 'string' ? (m[l] as string).trim() : '')
  for (const l of [locale, 'sk', 'en', ...CMS_LOCALES]) {
    const v = pick(l)
    if (v) return v
  }
  return null
}

/** Whether the announcement's time window contains `now`. */
export function isWithinWindow(
  row: Pick<AnnouncementRow, 'startsAt' | 'endsAt'>,
  now: Date,
): boolean {
  const startsAt = toDate(row.startsAt)
  const endsAt = toDate(row.endsAt)
  if (startsAt && startsAt.getTime() > now.getTime()) return false
  if (endsAt && endsAt.getTime() <= now.getTime()) return false
  return true
}

export function matchesAudience(
  audience: AnnouncementAudience,
  viewer: AnnouncementViewer,
): boolean {
  if (audience === 'all') return true
  if (audience === 'guests') return viewer === 'guest'
  if (audience === 'candidates') return viewer === 'candidate'
  return viewer === 'employer'
}

/**
 * Active announcements visible at `now`, text resolved for `locale`. With `audience`
 * omitted no audience filter is applied (the server does not know the viewer).
 * Rows without any text, or with an unknown audience, are dropped.
 */
export function selectAnnouncements(
  rows: readonly AnnouncementRow[],
  opts: { now: Date; locale: string; audience?: AnnouncementViewer },
): PublicAnnouncement[] {
  const out: PublicAnnouncement[] = []
  for (const row of rows) {
    if (!row.active || !isWithinWindow(row, opts.now)) continue
    const audience = (ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(row.audience)
      ? (row.audience as AnnouncementAudience)
      : null
    if (!audience) continue
    if (opts.audience && !matchesAudience(audience, opts.audience)) continue
    const message = resolveLocalized(row.message, opts.locale)
    if (!message) continue
    const linkUrl = row.linkUrl && isSafeCmsLink(row.linkUrl) ? row.linkUrl : null
    const updatedAt = toDate(row.updatedAt)
    out.push({
      id: row.id,
      version: updatedAt ? updatedAt.toISOString() : '',
      message,
      linkUrl,
      linkLabel: linkUrl ? resolveLocalized(row.linkLabel, opts.locale) : null,
      variant: (ANNOUNCEMENT_VARIANTS as readonly string[]).includes(row.variant)
        ? (row.variant as AnnouncementVariant)
        : 'info',
      audience,
      dismissible: row.dismissible,
      endsAt: toDate(row.endsAt)?.toISOString() ?? null,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Admin status
// ---------------------------------------------------------------------------

export type AnnouncementStatus = 'active' | 'scheduled' | 'expired' | 'inactive'

export function announcementStatus(
  row: Pick<AnnouncementRow, 'active' | 'startsAt' | 'endsAt'>,
  now: Date,
): AnnouncementStatus {
  if (!row.active) return 'inactive'
  const endsAt = toDate(row.endsAt)
  if (endsAt && endsAt.getTime() <= now.getTime()) return 'expired'
  const startsAt = toDate(row.startsAt)
  if (startsAt && startsAt.getTime() > now.getTime()) return 'scheduled'
  return 'active'
}
