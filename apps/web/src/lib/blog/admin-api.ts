/** Shared plumbing for the admin blog API routes (api/admin/cms/blog/**). */

import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import type { ZodError } from 'zod'
import { CMS_NOT_MIGRATED, isCmsTableMissing } from '@/lib/cms/safe'
import { logger } from '@/lib/logger'

export function validationError(error: ZodError) {
  return NextResponse.json({ error: 'Validation failed', issues: error.issues }, { status: 400 })
}

export function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { code?: unknown }).code === 'P2002'
}

/** 503 when the CMS tables are missing, 409 on a unique violation, otherwise a logged 500. */
export function blogApiError(
  error: unknown,
  label: string,
  conflictMessage = 'Slug already exists',
) {
  if (isCmsTableMissing(error)) return NextResponse.json(CMS_NOT_MIGRATED, { status: 503 })
  if (isUniqueViolation(error)) {
    return NextResponse.json({ error: conflictMessage, code: 'slug_taken' }, { status: 409 })
  }
  logger.error(`Admin blog API failed: ${label}`, { error })
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/** Route param from a Next 15 context (params is a Promise there; a plain object in tests). */
export async function routeParam(
  context: { params?: Record<string, string> } | undefined,
  name: string,
): Promise<string | null> {
  const params = (await Promise.resolve(context?.params)) as Record<string, string> | undefined
  const value = params && Object.prototype.hasOwnProperty.call(params, name) ? params[name] : null
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null
}

/** Drop cached public blog pages (list + every article, all locales). */
export function revalidateBlog(paths: string[] = []) {
  try {
    revalidatePath('/[locale]/blog', 'page')
    revalidatePath('/[locale]/blog/[slug]', 'page')
    for (const p of paths) revalidatePath(p)
  } catch (error) {
    // Outside a request scope (tests/scripts) revalidation is a no-op.
    logger.warn('Blog revalidation skipped', { error })
  }
}
