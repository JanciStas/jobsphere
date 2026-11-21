/**
 * Admin-side organisation membership.
 *
 * There was no way to do any of this. An admin could read an organisation's
 * members and change nothing about them — no route on the admin surface wrote
 * UserOrgRole at all. The only way to attach a user to a company was the invite
 * endpoint, which unconditionally created a NEW company, so "add this person to
 * that organisation" was not expressible.
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
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  requireGlobalAdmin,
  auth: requireGlobalAdmin,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    userOrgRole: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(async (ops: any) => (Array.isArray(ops) ? ops : ops)),
  },
}))

import { POST } from '../[id]/members/route'
import { PATCH, DELETE } from '../[id]/members/[userId]/route'
import { prisma } from '@/lib/prisma'

const ctx = { params: { id: 'org-1', userId: 'user-2' } }

const post = (body: unknown) =>
  new Request('http://localhost:3000/api/admin/organizations/org-1/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const patch = (body: unknown) =>
  new Request('http://localhost:3000/api/admin/organizations/org-1/members/user-2', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const del = () =>
  new Request('http://localhost:3000/api/admin/organizations/org-1/members/user-2', {
    method: 'DELETE',
  })

beforeEach(() => {
  vi.clearAllMocks()
  requireGlobalAdmin.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
  ;(prisma.organization.findUnique as any).mockResolvedValue({ id: 'org-1', name: 'Acme' })
  ;(prisma.user.findUnique as any).mockResolvedValue({
    id: 'user-2',
    email: 'member@acme.io',
    deletedAt: null,
  })
  ;(prisma.userOrgRole.findUnique as any).mockResolvedValue(null)
  ;(prisma.userOrgRole.create as any).mockResolvedValue({ userId: 'user-2', orgId: 'org-1' })
  ;(prisma.userOrgRole.update as any).mockResolvedValue({ userId: 'user-2', role: 'RECRUITER' })
  ;(prisma.userOrgRole.delete as any).mockResolvedValue({})
  ;(prisma.userOrgRole.count as any).mockResolvedValue(2)
  ;(prisma.user.update as any).mockResolvedValue({})
})

describe('access', () => {
  it.each([
    ['POST', () => POST(post({ email: 'member@acme.io' }), ctx)],
    ['PATCH', () => PATCH(patch({ role: 'RECRUITER' }), ctx)],
    ['DELETE', () => DELETE(del(), ctx)],
  ] as const)('%s refuses a non-admin and writes nothing', async (_m, invoke) => {
    requireGlobalAdmin.mockResolvedValue({ user: { id: 'u-1', isGlobalAdmin: false } })
    const res = await invoke()

    expect(res.status).toBe(403)
    expect(prisma.userOrgRole.create).not.toHaveBeenCalled()
    expect(prisma.userOrgRole.update).not.toHaveBeenCalled()
    expect(prisma.userOrgRole.delete).not.toHaveBeenCalled()
  })

  it.each([
    ['POST', () => POST(post({ email: 'member@acme.io' }), ctx)],
    ['PATCH', () => PATCH(patch({ role: 'RECRUITER' }), ctx)],
    ['DELETE', () => DELETE(del(), ctx)],
  ] as const)('%s answers 401 (not 403) when signed out', async (_m, invoke) => {
    requireGlobalAdmin.mockResolvedValue(null)
    expect((await invoke()).status).toBe(401)
  })

  it('PATCH with a malformed JSON body is a 400, not a 500', async () => {
    const bad = new Request('http://localhost:3000/api/admin/organizations/org-1/members/user-2', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })
    expect((await PATCH(bad, ctx)).status).toBe(400)
  })
})

describe('adding a member to an existing organisation', () => {
  it('attaches the user with the requested role', async () => {
    const res = await POST(post({ email: 'member@acme.io', role: 'HIRING_MANAGER' }), ctx)

    expect(res.status).toBe(201)
    expect(prisma.userOrgRole.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: 'user-2', orgId: 'org-1', role: 'HIRING_MANAGER' },
      }),
    )
  })

  it('defaults to RECRUITER rather than handing out ORG_ADMIN', async () => {
    // The invite endpoint hardcodes ORG_ADMIN; that is the wrong default for
    // "add a colleague", and the least-privilege one is the safer choice.
    await POST(post({ email: 'member@acme.io' }), ctx)
    const data = (prisma.userOrgRole.create as any).mock.calls[0][0].data
    expect(data.role).toBe('RECRUITER')
  })

  it('looks the user up case-insensitively', async () => {
    await POST(post({ email: 'Member@Acme.IO' }), ctx)
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'member@acme.io' } }),
    )
  })

  it('404s for an organisation that does not exist', async () => {
    ;(prisma.organization.findUnique as any).mockResolvedValue(null)
    const res = await POST(post({ email: 'member@acme.io' }), ctx)
    expect(res.status).toBe(404)
    expect(prisma.userOrgRole.create).not.toHaveBeenCalled()
  })

  it('refuses to silently provision an account for an unknown email', async () => {
    // Creating a user here would produce a second account for someone who may
    // already exist under a different address. That is the invite flow's job.
    ;(prisma.user.findUnique as any).mockResolvedValue(null)
    const res = await POST(post({ email: 'nobody@acme.io' }), ctx)

    expect(res.status).toBe(404)
    expect(prisma.userOrgRole.create).not.toHaveBeenCalled()
  })

  it('refuses a soft-deleted user', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({
      id: 'user-2',
      email: 'member@acme.io',
      deletedAt: new Date(),
    })
    const res = await POST(post({ email: 'member@acme.io' }), ctx)
    expect(res.status).toBe(404)
  })

  it('409s when they are already a member', async () => {
    ;(prisma.userOrgRole.findUnique as any).mockResolvedValue({ userId: 'user-2' })
    const res = await POST(post({ email: 'member@acme.io' }), ctx)

    expect(res.status).toBe(409)
    expect(prisma.userOrgRole.create).not.toHaveBeenCalled()
  })

  it('rejects an invalid role', async () => {
    const res = await POST(post({ email: 'member@acme.io', role: 'SUPERUSER' }), ctx)
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(prisma.userOrgRole.create).not.toHaveBeenCalled()
  })
})

describe('changing a role', () => {
  beforeEach(() => {
    ;(prisma.userOrgRole.findUnique as any).mockResolvedValue({
      userId: 'user-2',
      orgId: 'org-1',
      role: 'RECRUITER',
    })
  })

  it('updates the membership and revokes their sessions', async () => {
    // A role change that only takes effect when the JWT expires is not a role
    // change; the employer-side route does the same.
    const res = await PATCH(patch({ role: 'ORG_ADMIN' }), ctx)

    expect(res.status).toBe(200)
    expect(prisma.userOrgRole.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_orgId: { userId: 'user-2', orgId: 'org-1' } },
        data: { role: 'ORG_ADMIN' },
      }),
    )
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: { sessionEpoch: { increment: 1 } },
    })
  })

  it('refuses to demote the last ORG_ADMIN (same guard as DELETE)', async () => {
    ;(prisma.userOrgRole.findUnique as any).mockResolvedValue({
      userId: 'user-2',
      orgId: 'org-1',
      role: 'ORG_ADMIN',
    })
    ;(prisma.userOrgRole.count as any).mockResolvedValue(1)

    const res = await PATCH(patch({ role: 'RECRUITER' }), ctx)

    expect(res.status).toBe(400)
    expect(prisma.userOrgRole.update).not.toHaveBeenCalled()
  })

  it('allows demoting an ORG_ADMIN when another remains', async () => {
    ;(prisma.userOrgRole.findUnique as any).mockResolvedValue({
      userId: 'user-2',
      orgId: 'org-1',
      role: 'ORG_ADMIN',
    })
    ;(prisma.userOrgRole.count as any).mockResolvedValue(2)

    expect((await PATCH(patch({ role: 'RECRUITER' }), ctx)).status).toBe(200)
  })

  it('404s when there is no such membership', async () => {
    ;(prisma.userOrgRole.findUnique as any).mockResolvedValue(null)
    const res = await PATCH(patch({ role: 'ORG_ADMIN' }), ctx)

    expect(res.status).toBe(404)
    expect(prisma.userOrgRole.update).not.toHaveBeenCalled()
  })
})

describe('removing a member', () => {
  beforeEach(() => {
    ;(prisma.userOrgRole.findUnique as any).mockResolvedValue({
      userId: 'user-2',
      orgId: 'org-1',
      role: 'RECRUITER',
    })
  })

  it('deletes the membership and revokes their sessions', async () => {
    const res = await DELETE(del(), ctx)

    expect(res.status).toBe(200)
    expect(prisma.userOrgRole.delete).toHaveBeenCalledWith({
      where: { userId_orgId: { userId: 'user-2', orgId: 'org-1' } },
    })
    expect(prisma.user.update).toHaveBeenCalled()
  })

  it('refuses to remove the last ORG_ADMIN', async () => {
    // An organisation with no ORG_ADMIN cannot reach its own settings, team or
    // billing pages — removing the last one strands the company.
    ;(prisma.userOrgRole.findUnique as any).mockResolvedValue({
      userId: 'user-2',
      orgId: 'org-1',
      role: 'ORG_ADMIN',
    })
    ;(prisma.userOrgRole.count as any).mockResolvedValue(1)

    const res = await DELETE(del(), ctx)

    expect(res.status).toBe(400)
    expect(prisma.userOrgRole.delete).not.toHaveBeenCalled()
  })

  it('allows removing an ORG_ADMIN when another remains', async () => {
    ;(prisma.userOrgRole.findUnique as any).mockResolvedValue({
      userId: 'user-2',
      orgId: 'org-1',
      role: 'ORG_ADMIN',
    })
    ;(prisma.userOrgRole.count as any).mockResolvedValue(2)

    const res = await DELETE(del(), ctx)
    expect(res.status).toBe(200)
  })
})
