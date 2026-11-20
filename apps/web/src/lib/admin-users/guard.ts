/**
 * Shared guards for the admin "help an account" routes.
 *
 * Every route still calls `auth()` itself (the route-wrapper contract test looks
 * for that), this module only turns the session into the right HTTP answer and
 * centralises the "who may be touched" rules.
 */

import { NextResponse } from 'next/server'
import type { Session } from 'next-auth'
import { prisma } from '@/lib/prisma'

/** Far-future sentinel that `PATCH /api/admin/users` uses for "suspended". */
export const SUSPENDED_DATE = new Date('2099-01-01T00:00:00.000Z')
/** Anything at or after this is a suspension, anything before it a temporary lockout. */
export { SUSPENDED_THRESHOLD } from './roles'

/** 401 for anonymous, 403 for a signed-in non-admin, null when the caller is a global admin. */
export function adminDenied(session: Session | null): NextResponse | null {
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!session.user.isGlobalAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

export interface AdminTarget {
  id: string
  email: string
  name: string | null
  phone: string | null
  locale: string
  isGlobalAdmin: boolean
  emailVerified: Date | null
  lockedUntil: Date | null
  failedAttempts: number
  deletedAt: Date | null
}

/** Loads the account an admin action is aimed at. Null when it does not exist or is deleted. */
export async function loadTarget(id: string): Promise<AdminTarget | null> {
  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      locale: true,
      isGlobalAdmin: true,
      emailVerified: true,
      lockedUntil: true,
      failedAttempts: true,
      deletedAt: true,
    },
  })
  if (!target || target.deletedAt !== null) return null
  return target
}

/**
 * Accounts of other super admins are off-limits for help actions (e-mail,
 * password, unlock, ...). Only signing them out everywhere stays allowed, because
 * that is the emergency brake for a compromised admin account.
 */
export function protectedAdminResponse(target: Pick<AdminTarget, 'isGlobalAdmin'>) {
  if (target.isGlobalAdmin) {
    return NextResponse.json(
      { error: 'This action is not allowed on a super admin account' },
      { status: 403 },
    )
  }
  return null
}

export function paramId(context?: { params?: Record<string, string> }): string | null {
  const id = context?.params?.id
  return id && id.length > 0 && id.length <= 64 ? id : null
}
