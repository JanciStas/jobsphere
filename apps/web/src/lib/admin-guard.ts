/**
 * Server-side guard for platform-admin API routes.
 *
 * Distinguishes "not signed in" (401) from "signed in but not a global admin"
 * (403); `requireGlobalAdmin` collapses both into null.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

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
  const page = Math.max(1, Math.floor(Number(searchParams.get('page') ?? '1')) || 1)
  const limit = Math.min(
    100,
    Math.max(1, Math.floor(Number(searchParams.get('limit') ?? String(defaultLimit))) || 1),
  )
  return { page, limit, skip: (page - 1) * limit }
}
