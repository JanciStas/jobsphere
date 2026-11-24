/**
 * Pure helpers for the employer career page. No server imports: safe in client components.
 *
 * The public page only ever renders values that pass these checks, so a row written
 * before validation existed (or edited by hand in the DB) cannot inject a style or frame.
 */

export const CAREER_LIMITS = {
  headline: 120,
  subheadline: 240,
  about: 20_000,
  benefits: 12,
  benefit: 120,
  url: 2048,
} as const

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR.test(value)
}

/** Absolute https URL without embedded credentials. */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > CAREER_LIMITS.url) return false
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.username && !u.password
  } catch {
    return false
  }
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/
const VIMEO_PATH = /^\/(\d{1,12})\/?$/
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com'])
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com'])

/**
 * Turn a YouTube (`youtube.com/watch?v=`, `youtu.be/`) or Vimeo (`vimeo.com/<id>`) https
 * link into its privacy-friendly embed URL. Anything else returns null — the original URL
 * is never used as an iframe src.
 */
export function toVideoEmbedUrl(value: unknown): string | null {
  if (!isHttpsUrl(value)) return null
  const u = new URL(value)
  if (u.port) return null
  const host = u.hostname.toLowerCase()

  if (YOUTUBE_HOSTS.has(host)) {
    if (u.pathname !== '/watch') return null
    const id = u.searchParams.get('v')
    return id && YOUTUBE_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
  }
  if (host === 'youtu.be') {
    const id = u.pathname.replace(/^\//, '').replace(/\/$/, '')
    return YOUTUBE_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
  }
  if (VIMEO_HOSTS.has(host)) {
    const match = VIMEO_PATH.exec(u.pathname)
    return match ? `https://player.vimeo.com/video/${match[1]}` : null
  }
  return null
}

/** Black or white text, whichever reads better on the given brand color. */
export function readableTextColor(hex: string): '#000000' | '#ffffff' {
  if (!isHexColor(hex)) return '#ffffff'
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  // 0.179 is where the WCAG contrast ratio against black and against white is equal.
  return luminance > 0.179 ? '#000000' : '#ffffff'
}

/** Path of the public career page (without origin). */
export function careerPagePath(locale: string, slug: string): string {
  return `/${locale}/careers/${encodeURIComponent(slug)}`
}
