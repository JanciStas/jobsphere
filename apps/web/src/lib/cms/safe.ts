/**
 * The CMS tables (packages/db/prisma/migrations/20261124_cms) are applied to production by
 * hand. Until they exist, every public reader must fall back to the built-in texts instead
 * of returning a 500. Admin writes surface a recognizable "not migrated" error instead.
 */

import { logger } from '@/lib/logger'

const CMS_TABLES = [
  'CmsPage',
  'CmsFaqItem',
  'CmsText',
  'BlogCategory',
  'BlogPost',
  'SiteAnnouncement',
  'CareerPage',
]

const MISSING_RELATION = new RegExp(
  `(relation|table)\\s+"?(public\\.)?"?(${CMS_TABLES.join('|')})"?\\s+does not exist`,
  'i',
)

/** True when the error means a CMS table / column / enum is not in the database yet. */
export function isCmsTableMissing(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; message?: unknown }
  if (e.code === 'P2021' || e.code === 'P2022') return true
  if (typeof e.message !== 'string') return false
  return (
    MISSING_RELATION.test(e.message) || /type\s+"?CmsStatus"?\s+does not exist/i.test(e.message)
  )
}

/**
 * Run a CMS read; on a missing table return `fallback`. Any other error is logged and
 * also degrades to `fallback` — public pages must keep rendering the built-in content.
 */
export async function cmsRead<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (!isCmsTableMissing(error)) logger.error(`CMS read failed: ${label}`, { error })
    return fallback
  }
}

/** JSON body for admin APIs when the CMS migration has not been applied yet. */
export const CMS_NOT_MIGRATED = {
  error: 'CMS tables are missing. Apply packages/db/prisma/migrations/20261124_cms first.',
  code: 'cms_not_migrated',
} as const
