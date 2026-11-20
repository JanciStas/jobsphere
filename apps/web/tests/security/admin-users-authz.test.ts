/**
 * QA-012 — Admin users route rejects non-global-admins.
 *
 * `/api/admin/users` (GET list, PATCH ban/unban/promote/demote) is gated by
 * `requireGlobalAdmin()`. This pins:
 *   - 401 for an unauthenticated caller (no session);
 *   - 403 for an AUTHENTICATED user who is NOT a global admin;
 *   - on the 403 path, NO prisma read or write happens (the sensitive PATCH
 *     ban/promote actions must never touch the DB for a non-admin).
 *
 * NOTE: since the admin-help work the route distinguishes anonymous (401) from a
 * signed-in non-admin (403), via `adminDenied` in lib/admin-users/guard.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { GET, PATCH } from '@/app/api/admin/users/route'
import { prisma } from '@/lib/prisma'

function getReq(url = 'http://localhost:3000/api/admin/users') {
  return new Request(url)
}

function patchReq(body: unknown) {
  return new Request('http://localhost:3000/api/admin/users', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function assertNoUserDbAccess() {
  expect(prisma.user.findMany).not.toHaveBeenCalled()
  expect(prisma.user.count).not.toHaveBeenCalled()
  expect(prisma.user.findUnique).not.toHaveBeenCalled()
  expect(prisma.user.update).not.toHaveBeenCalled()
}

describe('QA-012 — admin users route authz', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/admin/users', () => {
    it('rejects an unauthenticated caller with 401 and no DB access', async () => {
      auth.mockResolvedValue(null)

      const res = await GET(getReq())

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe('Unauthorized')
      assertNoUserDbAccess()
    })

    it('rejects an authenticated NON-admin with 403 and no DB access', async () => {
      auth.mockResolvedValue({
        user: { id: 'user-1', email: 'plain@user.com', isGlobalAdmin: false },
      })

      const res = await GET(getReq())

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe('Forbidden')
      assertNoUserDbAccess()
    })

    it('allows a global admin through to the listing query', async () => {
      auth.mockResolvedValue({
        user: { id: 'admin-1', email: 'admin@x.com', isGlobalAdmin: true },
      })
      vi.mocked(prisma.user.findMany).mockResolvedValue([] as any)
      vi.mocked(prisma.user.count).mockResolvedValue(0 as any)

      const res = await GET(getReq())

      expect(res.status).toBe(200)
      expect(prisma.user.findMany).toHaveBeenCalledTimes(1)
    })
  })

  describe('PATCH /api/admin/users (ban / promote)', () => {
    it('rejects an unauthenticated ban attempt with 401 and no write', async () => {
      auth.mockResolvedValue(null)

      const res = await PATCH(patchReq({ userId: 'victim-1', action: 'ban' }))

      expect(res.status).toBe(401)
      const body = await res.json()
      expect(body.error).toBe('Unauthorized')
      assertNoUserDbAccess()
    })

    it('rejects a NON-admin trying to ban a user with 403 and no write', async () => {
      auth.mockResolvedValue({
        user: { id: 'attacker-1', email: 'attacker@x.com', isGlobalAdmin: false },
      })

      const res = await PATCH(patchReq({ userId: 'victim-1', action: 'ban' }))

      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toBe('Forbidden')
      // The most sensitive guarantee: no mutation reached prisma.
      expect(prisma.user.update).not.toHaveBeenCalled()
      assertNoUserDbAccess()
    })

    it('rejects a NON-admin trying to self-promote to admin with 403 and no write', async () => {
      auth.mockResolvedValue({
        user: { id: 'attacker-1', email: 'attacker@x.com', isGlobalAdmin: false },
      })

      const res = await PATCH(patchReq({ userId: 'attacker-1', action: 'promote_admin' }))

      expect(res.status).toBe(403)
      expect(prisma.user.update).not.toHaveBeenCalled()
      assertNoUserDbAccess()
    })

    it('lets a global admin perform a ban (control: write reaches prisma)', async () => {
      auth.mockResolvedValue({
        user: { id: 'admin-1', email: 'admin@x.com', isGlobalAdmin: true },
      })
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'victim-1',
        deletedAt: null,
      } as any)
      vi.mocked(prisma.user.update).mockResolvedValue({
        id: 'victim-1',
        name: 'Victim',
        email: 'victim@x.com',
        isGlobalAdmin: false,
        lockedUntil: new Date('2099-01-01T00:00:00.000Z'),
        failedAttempts: 0,
      } as any)

      const res = await PATCH(patchReq({ userId: 'victim-1', action: 'ban' }))

      expect(res.status).toBe(200)
      expect(prisma.user.update).toHaveBeenCalledTimes(1)
      const arg = vi.mocked(prisma.user.update).mock.calls[0][0] as any
      // Ban bumps sessionEpoch (revokes active JWTs) and sets the ban sentinel.
      expect(arg.data.sessionEpoch).toEqual({ increment: 1 })
      expect(arg.data.lockedUntil).toBeInstanceOf(Date)
    })
  })
})
