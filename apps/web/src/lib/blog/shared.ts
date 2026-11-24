/**
 * Blog helpers without server dependencies: safe to import from client components
 * (admin form) as well as from server pages and API routes.
 */

import { CMS_LOCALES } from '@/lib/cms/constants'

/** Posts per page on the public blog list. */
export const BLOG_PAGE_SIZE = 12

export const BLOG_TITLE_MAX = 200
export const BLOG_EXCERPT_MAX = 500
export const BLOG_SEO_TITLE_MAX = 200
export const BLOG_SEO_DESCRIPTION_MAX = 500
export const BLOG_TAGS_MAX = 10
export const BLOG_TAG_LENGTH_MAX = 40
export const BLOG_CATEGORY_NAME_MAX = 80

/** Admins schedule posts in Slovak time (DST aware). */
export const BLOG_TIME_ZONE = 'Europe/Bratislava'

const WORDS_PER_MINUTE = 200

/**
 * Estimated reading time in whole minutes (≥ 1) for a Markdown body. Strips code fences,
 * image/link URLs and Markdown punctuation before counting words.
 */
export function readingTimeMinutes(markdown: string | null | undefined): number {
  if (!markdown) return 1
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#>*_`~|-]+/g, ' ')
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

/**
 * Category name for `locale` from its `{ sk, en, ... }` JSON. Falls back to Slovak, then
 * English, then any filled-in locale, then the slug — never an empty string.
 */
export function categoryName(names: unknown, locale: string, slug: string): string {
  const map =
    names && typeof names === 'object' && !Array.isArray(names)
      ? (names as Record<string, unknown>)
      : {}
  const pick = (key: string) => {
    const value = Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }
  for (const key of [locale, 'sk', 'en', ...CMS_LOCALES]) {
    const value = pick(key)
    if (value) return value
  }
  return slug
}

/** True for a PUBLISHED post whose publishedAt lies in the future. */
export function isScheduled(
  post: { status: string; publishedAt: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (post.status !== 'PUBLISHED' || !post.publishedAt) return false
  return new Date(post.publishedAt).getTime() > now.getTime()
}

/** True when the post is visible on the public site right now. */
export function isLive(
  post: { status: string; publishedAt: Date | string | null },
  now: Date = new Date(),
): boolean {
  return post.status === 'PUBLISHED' && !!post.publishedAt && !isScheduled(post, now)
}

/** Vercel Blob hosts are whitelisted in next.config.js images.remotePatterns. */
export function isOptimizableImage(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname.endsWith('.public.blob.vercel-storage.com')
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// <input type="datetime-local"> <-> UTC instant, in Europe/Bratislava wall-clock time
// ---------------------------------------------------------------------------

const zoneFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BLOG_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function wallClock(d: Date) {
  const out: Record<string, number> = {}
  for (const p of zoneFormatter.formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return out as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>
}

/** Offset of Europe/Bratislava from UTC at instant `t`, in ms. */
function zoneOffsetMs(t: number): number {
  const w = wallClock(new Date(t))
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  return asUtc - (t - (((t % 1000) + 1000) % 1000))
}

const pad = (n: number) => String(n).padStart(2, '0')

/** UTC instant -> "YYYY-MM-DDTHH:mm" as shown on a Bratislava wall clock ('' for null). */
export function toZonedInputValue(value: Date | string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const w = wallClock(d)
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`
}

/** "YYYY-MM-DDTHH:mm" in Bratislava time -> UTC Date (null for empty/invalid input). */
export function fromZonedInputValue(value: string | null | undefined): Date | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const naive = Date.UTC(y, mo - 1, d, h, mi)
  if (Number.isNaN(naive)) return null
  // Two passes settle the offset across a DST switch.
  let t = naive - zoneOffsetMs(naive)
  t = naive - zoneOffsetMs(t)
  return new Date(t)
}
