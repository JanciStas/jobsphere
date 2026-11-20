/**
 * Admin "help an account" actions: authz (401 / 403), super-admin protection,
 * collision handling and the audit trail.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth }))

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/audit-log', () => ({
  createAuditLog,
  getRequestMetadata: () => ({ ipAddress: '1.2.3.4', userAgent: 'vitest' }),
}))

const { sendEmail } = vi.hoisted(() => ({ sendEmail: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendEmail }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    verificationToken: { deleteMany: vi.fn(), create: vi.fn() },
  },
}))

import { PATCH as patchProfile } from '@/app/api/admin/users/[id]/route'
import { PATCH as patchStatus } from '@/app/api/admin/users/route'
import { POST as verifyEmail } from '@/app/api/admin/users/[id]/verify-email/route'
import { POST as unlock } from '@/app/api/admin/users/[id]/unlock/route'
import { POST as revokeSessions } from '@/app/api/admin/users/[id]/revoke-sessions/route'
import { POST as passwordReset } from '@/app/api/admin/users/[id]/password-reset/route'
import { prisma } from '@/lib/prisma'

const ctx = { params: { id: 'target-1' } }
const adminSession = { user: { id: 'admin-1', isGlobalAdmin: true } }

function req(body: unknown = {}, method = 'POST') {
  return new Request('http://localhost:3000/api/admin/users/target-1/x', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function target(overrides: Record<string, unknown> = {}) {
  return {
    id: 'target-1',
    email: 'old@example.com',
    name: 'Old Name',
    phone: null,
    locale: 'sk',
    isGlobalAdmin: false,
    emailVerified: null,
    lockedUntil: null,
    failedAttempts: 0,
    deletedAt: null,
    ...overrides,
  }
}

const userMock = prisma.user as unknown as Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue(adminSession)
  userMock.findUnique.mockResolvedValue(target())
  userMock.update.mockResolvedValue({
    id: 'target-1',
    name: 'Old Name',
    email: 'old@example.com',
    phone: null,
    locale: 'sk',
  })
  sendEmail.mockResolvedValue({ success: true })
})

const ROUTES: [
  string,
  (r: Request, c?: { params?: Record<string, string> }) => Promise<Response>,
  unknown,
][] = [
  ['PATCH profile', patchProfile, { name: 'X' }],
  ['POST verify-email', verifyEmail, {}],
  ['POST unlock', unlock, {}],
  ['POST revoke-sessions', revokeSessions, {}],
  ['POST password-reset', passwordReset, {}],
]

describe.each(ROUTES)('%s authz', (_name, handler, body) => {
  it('answers 401 to an anonymous caller and touches nothing', async () => {
    auth.mockResolvedValue(null)
    const res = await handler(req(body), ctx)
    expect(res.status).toBe(401)
    expect(userMock.findUnique).not.toHaveBeenCalled()
    expect(userMock.update).not.toHaveBeenCalled()
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it('answers 403 to a signed-in non-admin and touches nothing', async () => {
    auth.mockResolvedValue({ user: { id: 'u-2', isGlobalAdmin: false } })
    const res = await handler(req(body), ctx)
    expect(res.status).toBe(403)
    expect(userMock.findUnique).not.toHaveBeenCalled()
    expect(userMock.update).not.toHaveBeenCalled()
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown or deleted account', async () => {
    userMock.findUnique.mockResolvedValue(null)
    const res = await handler(req(body), ctx)
    expect(res.status).toBe(404)
    expect(userMock.update).not.toHaveBeenCalled()
  })
})

describe('super admin protection', () => {
  beforeEach(() => userMock.findUnique.mockResolvedValue(target({ isGlobalAdmin: true })))

  it.each([
    ['PATCH profile', patchProfile, { email: 'new@example.com' }],
    ['verify-email', verifyEmail, {}],
    ['unlock', unlock, {}],
    ['password-reset', passwordReset, {}],
  ] as const)('%s is refused on a super admin account', async (_n, handler, body) => {
    const res = await handler(req(body), ctx)
    expect(res.status).toBe(403)
    expect(userMock.update).not.toHaveBeenCalled()
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it('revoke-sessions is still allowed (emergency brake)', async () => {
    const res = await revokeSessions(req(), ctx)
    expect(res.status).toBe(200)
    expect(userMock.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { sessionEpoch: { increment: 1 } },
    })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', resourceId: 'target-1' }),
    )
  })
})

describe('PATCH /api/admin/users/[id] (profile + e-mail)', () => {
  it('rejects unknown fields and bad e-mails with 400', async () => {
    expect((await patchProfile(req({ isGlobalAdmin: true }, 'PATCH'), ctx)).status).toBe(400)
    expect((await patchProfile(req({ email: 'nope' }, 'PATCH'), ctx)).status).toBe(400)
    expect(userMock.update).not.toHaveBeenCalled()
  })

  it('answers 409 when the new e-mail already belongs to another account', async () => {
    userMock.findUnique
      .mockResolvedValueOnce(target())
      .mockResolvedValueOnce({ id: 'someone-else' })
    const res = await patchProfile(req({ email: 'Taken@Example.com' }, 'PATCH'), ctx)
    expect(res.status).toBe(409)
    expect(userMock.update).not.toHaveBeenCalled()
  })

  it('answers 409 when the unique constraint is lost in a race (P2002)', async () => {
    userMock.findUnique.mockResolvedValueOnce(target()).mockResolvedValueOnce(null)
    userMock.update.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
    const res = await patchProfile(req({ email: 'race@example.com' }, 'PATCH'), ctx)
    expect(res.status).toBe(409)
  })

  it('changes the e-mail: normalises, resets verification, revokes sessions, audits before/after', async () => {
    userMock.findUnique.mockResolvedValueOnce(target()).mockResolvedValueOnce(null)
    userMock.update.mockResolvedValueOnce({
      id: 'target-1',
      name: 'Old Name',
      email: 'new@example.com',
      phone: null,
      locale: 'sk',
    })
    const res = await patchProfile(req({ email: ' New@Example.com ' }, 'PATCH'), ctx)
    expect(res.status).toBe(200)
    const data = userMock.update.mock.calls[0][0].data
    expect(data.email).toBe('new@example.com')
    expect(data.emailVerified).toBeNull()
    expect(data.sessionEpoch).toEqual({ increment: 1 })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'EMAIL_CHANGED',
        userId: 'admin-1',
        previous: expect.objectContaining({ email: 'old@example.com' }),
        metadata: expect.objectContaining({ email: 'new@example.com' }),
      }),
    )
  })

  it('a name-only edit does not touch e-mail or sessions', async () => {
    const res = await patchProfile(req({ name: 'New Name', phone: '+421 900' }, 'PATCH'), ctx)
    expect(res.status).toBe(200)
    const data = userMock.update.mock.calls[0][0].data
    expect(data).toEqual({ name: 'New Name', phone: '+421 900' })
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_UPDATED' }))
  })
})

describe('verify-email', () => {
  it('sets emailVerified and audits', async () => {
    const res = await verifyEmail(req(), ctx)
    expect(res.status).toBe(200)
    expect(userMock.update.mock.calls[0][0].data.emailVerified).toBeInstanceOf(Date)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ op: 'VERIFY_EMAIL' }) }),
    )
  })

  it('answers 409 when already verified', async () => {
    userMock.findUnique.mockResolvedValue(target({ emailVerified: new Date() }))
    expect((await verifyEmail(req(), ctx)).status).toBe(409)
    expect(userMock.update).not.toHaveBeenCalled()
  })
})

describe('unlock', () => {
  it('resets failedAttempts and lockedUntil and audits the previous state', async () => {
    userMock.findUnique.mockResolvedValue(
      target({ failedAttempts: 5, lockedUntil: new Date(Date.now() + 600000) }),
    )
    const res = await unlock(req(), ctx)
    expect(res.status).toBe(200)
    expect(userMock.update).toHaveBeenCalledWith({
      where: { id: 'target-1' },
      data: { failedAttempts: 0, lockedUntil: null },
    })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ previous: expect.objectContaining({ failedAttempts: 5 }) }),
    )
  })

  it('refuses to unlock a suspended account (that is "restore")', async () => {
    userMock.findUnique.mockResolvedValue(
      target({ lockedUntil: new Date('2099-01-01T00:00:00.000Z') }),
    )
    expect((await unlock(req(), ctx)).status).toBe(409)
    expect(userMock.update).not.toHaveBeenCalled()
  })
})

describe('password-reset', () => {
  const tokenMock = prisma.verificationToken as unknown as Record<string, ReturnType<typeof vi.fn>>

  it('link mode returns the reset link to the admin, no-store, and keeps it out of the audit trail', async () => {
    const res = await passwordReset(req({ mode: 'link' }), ctx)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = await res.json()
    expect(body.delivery).toBe('link')
    expect(body.resetUrl).toMatch(/\/reset-password\?token=[0-9a-f]{64}$/)
    expect(sendEmail).not.toHaveBeenCalled()

    // Only the sha256 hash is stored, never the raw token.
    const stored = tokenMock.create.mock.calls[0][0].data
    expect(stored.type).toBe('PASSWORD_RESET')
    expect(body.resetUrl).not.toContain(stored.token)
    const audit = JSON.stringify(createAuditLog.mock.calls)
    const rawToken = body.resetUrl.split('token=')[1]
    expect(audit).not.toContain(rawToken)
    expect(audit).toContain('PASSWORD_RESET_STARTED')
  })

  it('email mode sends the mail and does not leak the link', async () => {
    const prev = process.env.EMAIL_SERVICE
    process.env.EMAIL_SERVICE = 'resend'
    try {
      const res = await passwordReset(req({ mode: 'email' }), ctx)
      const body = await res.json()
      expect(body).toEqual({ delivery: 'email' })
      expect(sendEmail).toHaveBeenCalledOnce()
    } finally {
      if (prev === undefined) delete process.env.EMAIL_SERVICE
      else process.env.EMAIL_SERVICE = prev
    }
  })

  it('falls back to the link when delivery fails', async () => {
    const prev = process.env.EMAIL_SERVICE
    process.env.EMAIL_SERVICE = 'resend'
    sendEmail.mockResolvedValueOnce({ success: false, error: 'boom' })
    try {
      const body = await (await passwordReset(req({ mode: 'email' }), ctx)).json()
      expect(body.delivery).toBe('link')
      expect(body.resetUrl).toBeTruthy()
    } finally {
      if (prev === undefined) delete process.env.EMAIL_SERVICE
      else process.env.EMAIL_SERVICE = prev
    }
  })

  it('rejects an invalid mode with 400', async () => {
    expect((await passwordReset(req({ mode: 'sms' }), ctx)).status).toBe(400)
  })
})

describe('PATCH /api/admin/users (suspend / demote guards)', () => {
  function statusReq(body: unknown) {
    return new Request('http://localhost:3000/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('an admin cannot suspend themselves', async () => {
    const res = await patchStatus(statusReq({ userId: 'admin-1', action: 'ban' }))
    expect(res.status).toBe(400)
    expect(userMock.update).not.toHaveBeenCalled()
  })

  it('an admin cannot suspend another super admin', async () => {
    userMock.findUnique.mockResolvedValue(target({ isGlobalAdmin: true }))
    const res = await patchStatus(statusReq({ userId: 'target-1', action: 'ban' }))
    expect(res.status).toBe(403)
    expect(userMock.update).not.toHaveBeenCalled()
  })

  it('refuses to demote the last super admin', async () => {
    userMock.findUnique.mockResolvedValue(target({ isGlobalAdmin: true }))
    userMock.count.mockResolvedValue(1)
    const res = await patchStatus(statusReq({ userId: 'target-1', action: 'demote_admin' }))
    expect(res.status).toBe(409)
    expect(userMock.update).not.toHaveBeenCalled()
  })

  it('still suspends an ordinary account and audits it', async () => {
    userMock.update.mockResolvedValue({
      id: 'target-1',
      name: null,
      email: 'x@y.z',
      isGlobalAdmin: false,
      lockedUntil: new Date('2099-01-01T00:00:00.000Z'),
      failedAttempts: 0,
    })
    const res = await patchStatus(statusReq({ userId: 'target-1', action: 'ban' }))
    expect(res.status).toBe(200)
    expect(createAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'BAN' }))
  })
})
