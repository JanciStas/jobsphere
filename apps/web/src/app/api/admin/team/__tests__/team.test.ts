/**
 * Admin team API: authZ (401/403), validation, last-admin / self-removal safeguards,
 * sessionEpoch bump and audit logging.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({
  createAuditLog: vi.fn(),
  getRequestMetadata: () => ({ ipAddress: '127.0.0.1', userAgent: 'vitest' }),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: any) => h }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (h: any) => h }))

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth }))

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() } },
}))

import { GET, POST } from '../route'
import { DELETE } from '../[id]/route'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit-log'

const post = (body: unknown) =>
  new Request('http://localhost/api/admin/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const del = (id: string) =>
  DELETE(new Request(`http://localhost/api/admin/team/${id}`, { method: 'DELETE' }), {
    params: { id },
  })

const u = prisma.user as any

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
})

describe('authorization', () => {
  it.each([
    ['anonymous', null, 401],
    ['non-admin', { user: { id: 'u1', isGlobalAdmin: false } }, 403],
  ])('%s gets %i on every verb and nothing is written', async (_n, session, status) => {
    auth.mockResolvedValue(session)
    expect((await GET(new Request('http://localhost/api/admin/team'))).status).toBe(status)
    expect((await POST(post({ email: 'a@b.sk' }))).status).toBe(status)
    expect((await del('x')).status).toBe(status)
    expect(u.update).not.toHaveBeenCalled()
    expect(createAuditLog).not.toHaveBeenCalled()
  })
})

describe('GET', () => {
  it('never selects password or tokens', async () => {
    u.findMany.mockResolvedValue([])
    await GET(new Request('http://localhost/api/admin/team'))
    const select = u.findMany.mock.calls[0][0].select
    expect(select).not.toHaveProperty('password')
    expect(select).toEqual({
      id: true,
      name: true,
      email: true,
      lastLoginAt: true,
      createdAt: true,
    })
  })
})

describe('POST (promote)', () => {
  it('rejects an invalid email', async () => {
    expect((await POST(post({ email: 'nope' }))).status).toBe(400)
  })
  it('404 for unknown user, 409 if already admin', async () => {
    u.findUnique.mockResolvedValue(null)
    expect((await POST(post({ email: 'a@b.sk' }))).status).toBe(404)
    u.findUnique.mockResolvedValue({ id: 'u2', isGlobalAdmin: true, deletedAt: null })
    expect((await POST(post({ email: 'a@b.sk' }))).status).toBe(409)
    expect(u.update).not.toHaveBeenCalled()
  })
  it('refuses to promote an unverified, passwordless or suspended account', async () => {
    const base = {
      id: 'u2',
      isGlobalAdmin: false,
      deletedAt: null,
      emailVerified: new Date(),
      password: 'hash',
      lockedUntil: null,
    }
    for (const bad of [
      { ...base, emailVerified: null },
      { ...base, password: null },
      { ...base, lockedUntil: new Date(Date.now() + 86_400_000) },
    ]) {
      u.findUnique.mockResolvedValue(bad)
      expect((await POST(post({ email: 'a@b.sk' }))).status).toBe(409)
    }
    expect(u.update).not.toHaveBeenCalled()
  })
  it('promotes, bumps sessionEpoch and audits', async () => {
    u.findUnique.mockResolvedValue({
      id: 'u2',
      isGlobalAdmin: false,
      deletedAt: null,
      emailVerified: new Date(),
      password: 'hash',
      lockedUntil: null,
    })
    u.update.mockResolvedValue({ id: 'u2', email: 'a@b.sk' })
    const res = await POST(post({ email: ' A@B.sk ' }))
    expect(res.status).toBe(201)
    expect(u.findUnique.mock.calls[0][0].where.email).toBe('a@b.sk')
    expect(u.update.mock.calls[0][0].data).toEqual({
      isGlobalAdmin: true,
      sessionEpoch: { increment: 1 },
    })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'PROMOTE_ADMIN',
        resource: 'USER',
        resourceId: 'u2',
        previous: { isGlobalAdmin: false },
      }),
    )
  })
})

describe('DELETE (demote)', () => {
  it('refuses to remove yourself', async () => {
    expect((await del('admin-1')).status).toBe(400)
    expect(u.update).not.toHaveBeenCalled()
  })
  it('refuses to remove the last admin', async () => {
    u.findUnique.mockResolvedValue({ id: 'u2', isGlobalAdmin: true, deletedAt: null })
    u.count.mockResolvedValue(1)
    expect((await del('u2')).status).toBe(400)
    expect(u.update).not.toHaveBeenCalled()
  })
  it('400 for a non-admin target, 404 for unknown', async () => {
    u.findUnique.mockResolvedValue({ id: 'u2', isGlobalAdmin: false, deletedAt: null })
    expect((await del('u2')).status).toBe(400)
    u.findUnique.mockResolvedValue(null)
    expect((await del('u3')).status).toBe(404)
  })
  it('demotes, bumps sessionEpoch and audits', async () => {
    u.findUnique.mockResolvedValue({ id: 'u2', isGlobalAdmin: true, deletedAt: null })
    u.count.mockResolvedValue(2)
    u.update.mockResolvedValue({})
    expect((await del('u2')).status).toBe(200)
    expect(u.update.mock.calls[0][0].data).toEqual({
      isGlobalAdmin: false,
      sessionEpoch: { increment: 1 },
    })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DEMOTE_ADMIN', resourceId: 'u2' }),
    )
  })
  it('rejects a malformed id', async () => {
    expect((await del('../x')).status).toBe(400)
  })
})
