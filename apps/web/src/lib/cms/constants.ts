/** Shared CMS vocabulary. Pure module: safe to import from client components. */

export const CMS_LOCALES = ['sk', 'en', 'de', 'cs', 'pl'] as const
export type CmsLocale = (typeof CMS_LOCALES)[number]

export function isCmsLocale(value: unknown): value is CmsLocale {
  return typeof value === 'string' && (CMS_LOCALES as readonly string[]).includes(value)
}

/** URL slug: lowercase letters, digits and single dashes, 1–120 chars. */
export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const SLUG_MAX = 120

/** Turn a title into a slug (strips Slovak/Czech/Polish/German diacritics). */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[łŁ]/g, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '')
}

/** Only absolute http(s) URLs or site-relative paths are accepted as CMS links. */
export function isSafeCmsLink(value: string): boolean {
  if (value.startsWith('/') && !value.startsWith('//')) return true
  try {
    const u = new URL(value)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}
