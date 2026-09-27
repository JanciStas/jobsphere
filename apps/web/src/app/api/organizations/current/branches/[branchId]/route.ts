import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveActiveMembership } from '@/lib/api-helpers'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { z } from 'zod'

export const runtime = 'nodejs'

const updateBranchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  street: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  region: z.string().trim().max(120).optional().nullable(),
  country: z.string().trim().max(120).optional().nullable(),
  postalCode: z.string().trim().max(40).optional().nullable(),
  isPrimary: z.boolean().optional(),
})

// Resolve the caller's org membership and the target branch, enforcing that the
// branch belongs to the caller's own org (IDOR guard). Returns a discriminated
// result so handlers can early-return the right status.
async function loadBranchInOrg(
  userId: string,
  activeOrgId: string | null | undefined,
  branchId: string,
): Promise<{ ok: true; orgId: string } | { ok: false; status: 401 | 403 | 404; error: string }> {
  const userOrgRole = await resolveActiveMembership(userId, activeOrgId)
  if (!userOrgRole) {
    return { ok: false, status: 404, error: 'Organization not found' }
  }

  const branch = await prisma.branch.findUnique({ where: { id: branchId } })
  if (!branch || branch.deletedAt) {
    return { ok: false, status: 404, error: 'Branch not found' }
  }
  if (branch.orgId !== userOrgRole.orgId) {
    return { ok: false, status: 403, error: 'Forbidden' }
  }
  return { ok: true, orgId: userOrgRole.orgId }
}

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (request: Request, context?: { params?: Record<string, string> }) => {
      const params = context?.params as { branchId: string }
      if (!params?.branchId) {
        return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
      }
      try {
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const access = await loadBranchInOrg(
          session.user.id,
          session.user.activeOrgId,
          params.branchId,
        )
        if (!access.ok) {
          return NextResponse.json({ error: access.error }, { status: access.status })
        }

        const body = await request.json()
        const data = updateBranchSchema.parse(body)
        const { orgId } = access

        const updated = await prisma.$transaction(async (tx) => {
          if (data.isPrimary) {
            await tx.branch.updateMany({
              where: { orgId, isPrimary: true, deletedAt: null, id: { not: params.branchId } },
              data: { isPrimary: false },
            })
          }
          return tx.branch.update({
            where: { id: params.branchId },
            data: {
              ...(data.name !== undefined && { name: data.name }),
              ...(data.street !== undefined && { street: data.street }),
              ...(data.city !== undefined && { city: data.city }),
              ...(data.region !== undefined && { region: data.region }),
              ...(data.country !== undefined && { country: data.country }),
              ...(data.postalCode !== undefined && { postalCode: data.postalCode }),
              ...(data.isPrimary !== undefined && { isPrimary: data.isPrimary }),
            },
          })
        })

        return NextResponse.json({ branch: updated })
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'Invalid request data', details: error.errors },
            { status: 400 },
          )
        }
        logger.error('Error updating branch:', error)
        return NextResponse.json({ error: 'Failed to update branch' }, { status: 500 })
      }
    },
    { preset: 'api', byUser: true },
  ),
)

export const DELETE = withCsrfProtection(
  withRateLimit(
    async (request: Request, context?: { params?: Record<string, string> }) => {
      const params = context?.params as { branchId: string }
      if (!params?.branchId) {
        return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 })
      }
      try {
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const access = await loadBranchInOrg(
          session.user.id,
          session.user.activeOrgId,
          params.branchId,
        )
        if (!access.ok) {
          return NextResponse.json({ error: access.error }, { status: access.status })
        }

        await prisma.branch.update({
          where: { id: params.branchId },
          data: { deletedAt: new Date(), isPrimary: false },
        })

        return NextResponse.json({ success: true })
      } catch (error) {
        logger.error('Error deleting branch:', error)
        return NextResponse.json({ error: 'Failed to delete branch' }, { status: 500 })
      }
    },
    { preset: 'api', byUser: true },
  ),
)
