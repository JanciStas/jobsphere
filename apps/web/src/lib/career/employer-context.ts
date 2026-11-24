/**
 * Caller resolution for /api/employer/career-page*. Same org resolution as
 * /api/organizations/current (the API behind the settings profile tab): the session's
 * active org, else the oldest live membership. The org NEVER comes from the request.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { resolveActiveMembership } from '@/lib/api-helpers'

export interface CareerEmployerContext {
  userId: string
  orgId: string
  slug: string
  role: string
  canEdit: boolean
}

type Resolved = { ok: true; ctx: CareerEmployerContext } | { ok: false; response: Response }

export async function resolveCareerEmployer(options: { requireAdmin: boolean }): Promise<Resolved> {
  const session = await auth()
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const membership = await resolveActiveMembership(session.user.id, session.user.activeOrgId, {
    organization: { select: { id: true, slug: true, deletedAt: true } },
  })
  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Organization not found' }, { status: 404 }),
    }
  }
  // A suspended org (admin sets deletedAt) keeps its memberships but may not publish anything.
  if (membership.organization.deletedAt) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Organization is suspended', code: 'org_suspended' },
        { status: 403 },
      ),
    }
  }

  const canEdit = membership.role === 'ORG_ADMIN'
  if (options.requireAdmin && !canEdit) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden - only organization admins can edit the career page' },
        { status: 403 },
      ),
    }
  }

  return {
    ok: true,
    ctx: {
      userId: session.user.id,
      orgId: membership.orgId,
      slug: membership.organization.slug,
      role: membership.role,
      canEdit,
    },
  }
}
