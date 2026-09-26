import { NextRequest } from 'next/server'
import type { Prisma } from '@prisma/client'
import { auth, UnauthorizedError } from './auth'
import { prisma } from './prisma'

export { UnauthorizedError }

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message)
    this.name = 'NotFoundError'
  }
}

export interface AuthContext {
  userId: string
  orgId: string
  role: string
  email: string
}

/**
 * Resolve the caller's live membership: the org they are currently acting in
 * (`activeOrgId`) first, otherwise their first live membership (oldest first).
 * `deletedAt: null` is explicit (the soft-delete middleware skips nested include
 * and findUnique) so a removed member never resolves. Returns null when none.
 */
export async function resolveActiveMembership<
  I extends Prisma.UserOrgRoleInclude | undefined = undefined,
>(userId: string, activeOrgId?: string | null, include?: I) {
  type Row = Prisma.UserOrgRoleGetPayload<{ include: NonNullable<I> }>
  const extra = include ? { include } : {}
  let member: unknown = activeOrgId
    ? await prisma.userOrgRole.findFirst({
        where: { userId, orgId: activeOrgId, deletedAt: null },
        ...extra,
      } as Prisma.UserOrgRoleFindFirstArgs)
    : null

  if (!member) {
    member = await prisma.userOrgRole.findFirst({
      where: { userId, deletedAt: null },
      ...extra,
      orderBy: { createdAt: 'asc' },
    } as Prisma.UserOrgRoleFindFirstArgs)
  }

  return member as Row | null
}

/**
 * Require authentication and organization membership.
 * The request argument is accepted for call-site ergonomics but unused — auth
 * comes from the NextAuth session — so it is optional.
 */
export async function requireOrgAuth(_request?: NextRequest): Promise<AuthContext> {
  const session = await auth()

  if (!session?.user?.id) {
    throw new UnauthorizedError()
  }

  const orgMember = await resolveActiveMembership(
    session.user.id,
    session.user.activeOrgId ?? null,
    { organization: true },
  )

  if (!orgMember) {
    throw new ForbiddenError('No organization membership found')
  }

  return {
    userId: session.user.id,
    orgId: orgMember.orgId,
    role: orgMember.role,
    email: session.user.email!,
  }
}

/**
 * Require authentication and organization membership.
 * @deprecated prefer {@link requireOrgAuth}; kept for backwards compatibility.
 */
export const requireAuth = requireOrgAuth

/**
 * Require the caller to hold one of the allowed org roles (AUTH-006).
 * Throws ForbiddenError (403) when authenticated but under-privileged.
 *
 * Roles: ORG_ADMIN, RECRUITER, HIRING_MANAGER, AGENCY
 */
export async function requireRole(
  allowedRoles: string[],
  request?: NextRequest,
): Promise<AuthContext> {
  const ctx = await requireOrgAuth(request)

  if (!allowedRoles.includes(ctx.role)) {
    throw new ForbiddenError(`Role ${ctx.role} not allowed`)
  }

  return ctx
}

/**
 * Optional auth (returns null if not authenticated)
 */
export async function optionalAuth(request: NextRequest): Promise<AuthContext | null> {
  try {
    return await requireAuth(request)
  } catch {
    return null
  }
}
