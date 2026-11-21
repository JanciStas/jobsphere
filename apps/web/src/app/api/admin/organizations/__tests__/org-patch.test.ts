/**
 * PATCH /api/admin/organizations.
 *
 * Until now this route understood exactly two verbs, suspend and activate, and
 * an organisation could therefore be created and suspended but never edited —
 * a typo in a company name was permanent. It also left every member of a
 * suspended organisation holding a working session.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({
  createAuditLog: vi.fn(),
  getRequestMetadata: () => ({ ipAddress: '127.0.0.1', userAgent: 'vitest' }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (handler: any) => handler }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (handler: any) => handler }))

const { requireGlobalAdmin } = vi.hoisted(() => ({ requireGlobalAdmin: vi.fn() }))
// Partial mock: lib/errors.ts reaches UnauthorizedError through this module, so
// replacing it wholesale makes handleApiError throw while handling a zod error —
// which is the path every validation test below takes.
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  requireGlobalAdmin,
  auth: requireGlobalAdmin,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findUnique: vi.fn(), update: vi.fn() },
    user: { updateMany: vi.fn() },
  },
}))

import { PATCH } from '../route'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit-log'

const ORG = {
  id: 'org-1',
  name: 'TechCorp',
  slug: 'techcorp',
  industry: 'IT',
  size: '50-200',
  website: 'https://techcorp.test',
  deletedAt: null,
}

const patch = (body: unknown) =>
  new Request('http://localhost:3000/api/admin/organizations', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  requireGlobalAdmin.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
  ;(prisma.organization.findUnique as any).mockResolvedValue(ORG)
  ;(prisma.organization.update as any).mockResolvedValue(ORG)
  ;(prisma.user.updateMany as any).mockResolvedValue({ count: 3 })
})

describe('access', () => {
  it('refuses a non-admin and writes nothing', async () => {
    requireGlobalAdmin.mockResolvedValue({ user: { id: 'u-1', isGlobalAdmin: false } })
    const res = await PATCH(patch({ action: 'suspend', orgId: 'org-1' }))

    expect(res.status).toBe(403)
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })

  it('404s for an organisation that does not exist', async () => {
    ;(prisma.organization.findUnique as any).mockResolvedValue(null)
    const res = await PATCH(patch({ action: 'suspend', orgId: 'nope' }))

    expect(res.status).toBe(404)
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })
})

describe('update', () => {
  it('changes the editable fields', async () => {
    const res = await PATCH(
      patch({
        action: 'update',
        orgId: 'org-1',
        name: 'TechCorp SK',
        industry: 'Software',
        website: 'https://techcorp.sk',
      }),
    )

    expect(res.status).toBe(200)
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: expect.objectContaining({
          name: 'TechCorp SK',
          industry: 'Software',
          website: 'https://techcorp.sk',
        }),
      }),
    )
  })

  it('refuses to touch the slug', async () => {
    // The slug is in the public company URL; renaming it breaks every existing
    // link to that profile. It is not in the schema, so it is dropped rather
    // than applied.
    await PATCH(patch({ action: 'update', orgId: 'org-1', slug: 'something-else' }))

    const data = (prisma.organization.update as any).mock.calls[0][0].data
    expect(data).not.toHaveProperty('slug')
  })

  it('does not clear a field the caller did not send', async () => {
    await PATCH(patch({ action: 'update', orgId: 'org-1', name: 'Only the name' }))

    const data = (prisma.organization.update as any).mock.calls[0][0].data
    expect(data).toEqual({ name: 'Only the name' })
  })

  it('clears a field explicitly set to null', async () => {
    await PATCH(patch({ action: 'update', orgId: 'org-1', website: null }))

    const data = (prisma.organization.update as any).mock.calls[0][0].data
    expect(data.website).toBeNull()
  })

  it('rejects a malformed website', async () => {
    const res = await PATCH(patch({ action: 'update', orgId: 'org-1', website: 'not-a-url' }))
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })

  it('records what the organisation was before', async () => {
    await PATCH(patch({ action: 'update', orgId: 'org-1', name: 'Renamed' }))

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        resource: 'ORGANIZATION',
        previous: expect.objectContaining({ name: 'TechCorp' }),
      }),
    )
  })
})

describe('suspend and activate', () => {
  it('suspending sets deletedAt', async () => {
    await PATCH(patch({ action: 'suspend', orgId: 'org-1' }))
    const data = (prisma.organization.update as any).mock.calls[0][0].data
    expect(data.deletedAt).toBeInstanceOf(Date)
  })

  it('activating clears it', async () => {
    await PATCH(patch({ action: 'activate', orgId: 'org-1' }))
    const data = (prisma.organization.update as any).mock.calls[0][0].data
    expect(data.deletedAt).toBeNull()
  })

  it('suspending revokes every member session', async () => {
    // Without this the organisation is gone as far as the platform is concerned
    // while its members carry on browsing until their JWTs expire.
    await PATCH(patch({ action: 'suspend', orgId: 'org-1' }))

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { organizations: { some: { orgId: 'org-1' } } },
      data: { sessionEpoch: { increment: 1 } },
    })
  })

  it('activating does not touch sessions', async () => {
    await PATCH(patch({ action: 'activate', orgId: 'org-1' }))
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ['suspend', 'SUSPEND'],
    ['activate', 'ACTIVATE'],
  ])('%s is audited as %s', async (action, auditAction) => {
    await PATCH(patch({ action, orgId: 'org-1' }))
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: auditAction, resource: 'ORGANIZATION' }),
    )
  })
})

describe('unknown verbs', () => {
  it.each(['delete', 'archive', ''])('rejects %s', async (action) => {
    const res = await PATCH(patch({ action, orgId: 'org-1' }))
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(prisma.organization.update).not.toHaveBeenCalled()
  })
})
