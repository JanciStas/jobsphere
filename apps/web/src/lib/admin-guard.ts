/**
 * Server-side guard for platform-admin API routes.
 *
 * Distinguishes "not signed in" (401) from "signed in but not a global admin"
 * (403); `requireGlobalAdmin` collapses both into null.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { parseLimit, parsePageNumber } from '@/lib/admin/paging'

export async function requireAdminApi() {
  const session = await auth()
  if (!session?.user?.id) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    }
  }
  if (!session.user.isGlobalAdmin) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }
  return { ok: true as const, session }
}

export function parsePaging(searchParams: URLSearchParams, defaultLimit = 25) {
  const page = parsePageNumber(searchParams.get('page'))
  const limit = parseLimit(searchParams.get('limit'), defaultLimit)
  return { page, limit, skip: (page - 1) * limit }
}
