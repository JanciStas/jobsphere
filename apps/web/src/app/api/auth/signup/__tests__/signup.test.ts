/**
 * AUTH-008 / AUTH-009 — signup is generic (no enumeration) and does not auto-verify.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: any) => h }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { hash } = vi.hoisted(() => ({ hash: vi.fn().mockResolvedValue('hashed') }))
vi.mock('bcryptjs', () => ({ hash }))

const { createEmailVerificationToken } = vi.hoisted(() => ({
  createEmailVerificationToken: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/services/user.service', () => ({
  UserService: { createEmailVerificationToken },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn() },
    organization: { findUnique: vi.fn() },
    userOrgRole: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { POST } from '../route'
import { prisma } from '@/lib/prisma'

const VALID_PASSWORD = 'StrongPass1!xyz' // 12+, upper/lower/digit/special

function req(body: Record<string, unknown>) {
  return new Request('http://localhost:3000/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('AUTH-008/009 signup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates an UNVERIFIED user and sends a verification email', async () => {
    let capturedCreate: any
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) =>
      cb({
        user: {
          create: vi.fn().mockImplementation((opts) => {
            capturedCreate = opts
            return { id: 'u1', name: 'Jane', email: 'jane@example.com' }
          }),
        },
        organization: { findUnique: vi.fn() },
        userOrgRole: { create: vi.fn() },
      }),
    )

    const res = await POST(
      req({ name: 'Jane', email: 'jane@example.com', password: VALID_PASSWORD }) as any,
    )
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    // emailVerified must NOT be set at creation time
    expect(capturedCreate.data.emailVerified).toBeUndefined()
    expect(createEmailVerificationToken).toHaveBeenCalledWith('jane@example.com')
  })

  it('returns the SAME generic response when the email already exists (no enumeration)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'existing' } as any)

    const res = await POST(
      req({ name: 'Jane', email: 'taken@example.com', password: VALID_PASSWORD }) as any,
    )
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    // No user creation, no token issued for an already-registered email
    expect(prisma.$transaction).not.toHaveBeenCalled()
    expect(createEmailVerificationToken).not.toHaveBeenCalled()
    // Response must not reveal that the account exists
    expect(JSON.stringify(json)).not.toMatch(/already exists/i)
  })

  it('agency signup creates an Organization and an AGENCY membership', async () => {
    let roleData: any
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) =>
      cb({
        user: { create: vi.fn().mockResolvedValue({ id: 'u2' }) },
        organization: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'o1' }),
        },
        userOrgRole: {
          create: vi.fn().mockImplementation((opts) => {
            roleData = opts.data
          }),
        },
      }),
    )

    const res = await POST(
      req({
        name: 'Ann',
        email: 'ann@agency.com',
        password: VALID_PASSWORD,
        role: 'agency',
        companyName: 'Talent Partners',
      }) as any,
    )
    expect(res.status).toBe(201)
    expect(roleData).toMatchObject({ userId: 'u2', orgId: 'o1', role: 'AGENCY' })
  })

  it('agency signup without company name is rejected', async () => {
    const res = await POST(
      req({
        name: 'Ann',
        email: 'ann@agency.com',
        password: VALID_PASSWORD,
        role: 'agency',
      }) as any,
    )
    expect(res.status).toBe(400)
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('employer signup keeps the ORG_ADMIN role', async () => {
    let roleData: any
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) =>
      cb({
        user: { create: vi.fn().mockResolvedValue({ id: 'u3' }) },
        organization: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'o2' }),
        },
        userOrgRole: {
          create: vi.fn().mockImplementation((opts) => {
            roleData = opts.data
          }),
        },
      }),
    )
    await POST(
      req({
        name: 'Bob',
        email: 'bob@corp.com',
        password: VALID_PASSWORD,
        role: 'employer',
        companyName: 'Corp',
      }) as any,
    )
    expect(roleData.role).toBe('ORG_ADMIN')
  })
})
