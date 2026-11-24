/**
 * Admin overrides of a WHITELIST of existing i18n texts (CmsText). The key is the full
 * message path in apps/web/messages/<locale>.json; a missing row means the built-in text.
 * Values are plain text (React escapes them), never Markdown/HTML. Server-only (Prisma).
 */

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { cmsRead } from './safe'
import { CMS_LOCALES, isCmsLocale } from './constants'

export const CMS_TEXT_KEYS = [
  // Home page (/[locale]) — root namespace
  'hero.title',
  'hero.subtitle',
  'hero.ctaPrimary',
  'hero.ctaSecondary',
  'page.cta.title',
  'page.cta.subtitle',
  // Pricing (/[locale]/pricing)
  'pricing.title',
  'pricing.subtitle',
  'pricing.cta.title',
  'pricing.cta.subtitle',
  // For employers (/[locale]/for-employers)
  'forEmployers.hero.title',
  'forEmployers.hero.subtitle',
  'forEmployers.hero.cta.start',
  'forEmployers.cta.title',
  'forEmployers.cta.subtitle',
] as const
export type CmsTextKey = (typeof CMS_TEXT_KEYS)[number]

export const CMS_TEXT_MAX_LENGTH = 500

export function isCmsTextKey(value: unknown): value is CmsTextKey {
  return typeof value === 'string' && (CMS_TEXT_KEYS as readonly string[]).includes(value)
}

/** Public path (after /{locale}) on which a key is shown. */
export function cmsTextPath(key: CmsTextKey): '' | '/pricing' | '/for-employers' {
  if (key.startsWith('pricing.')) return '/pricing'
  if (key.startsWith('forEmployers.')) return '/for-employers'
  return ''
}

/** Overrides for the given keys in a locale: { key: value }. {} on missing table / error. */
export async function getCmsTextOverrides(
  locale: string,
  keys: readonly string[] = CMS_TEXT_KEYS,
): Promise<Record<string, string>> {
  const wanted = keys.filter(isCmsTextKey)
  if (!isCmsLocale(locale) || wanted.length === 0) return {}
  return cmsRead(
    `texts ${locale}`,
    async () => {
      const rows = await prisma.cmsText.findMany({
        where: { locale, key: { in: wanted } },
        select: { key: true, value: true },
      })
      const out: Record<string, string> = {}
      for (const row of rows) if (row.value.trim()) out[row.key] = row.value
      return out
    },
    {},
  )
}

/** Whitelisted keys under a namespace prefix (e.g. 'pricing'), or all keys. */
export function cmsTextKeysFor(namespace?: string): CmsTextKey[] {
  if (!namespace) return [...CMS_TEXT_KEYS]
  return CMS_TEXT_KEYS.filter((key) => key.startsWith(`${namespace}.`))
}

/**
 * Translator with CMS overrides. Pass the same namespace the translator was created with:
 *
 *   const t = await getTranslations({ locale, namespace: 'forEmployers' })
 *   const tx = await cmsTexts(locale, t, 'forEmployers')
 *   tx('hero.title') // override of 'forEmployers.hero.title' ?? t('hero.title')
 */
export async function cmsTexts(
  locale: string,
  t: (key: string) => string,
  namespace?: string,
): Promise<(key: string) => string> {
  const prefix = namespace ? `${namespace}.` : ''
  const overrides = await getCmsTextOverrides(locale, cmsTextKeysFor(namespace))
  return (key: string) => overrides[`${prefix}${key}`] ?? t(key)
}

/** Revalidate the page showing `key` in every locale after an admin write. */
export function revalidateCmsText(key: CmsTextKey): void {
  const path = cmsTextPath(key)
  for (const locale of CMS_LOCALES) revalidatePath(`/${locale}${path}`)
}
