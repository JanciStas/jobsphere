/**
 * Superadmin org creation (POST /api/admin/organizations).
 * Pins the authz guard (403 for non-global-admins) and the happy path
 * (slug-gen + create → 201).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({
  createAuditLog: vi.fn(),
  getRequestMetadata: () => ({ ipAddress: '127.0.0.1', userAgent: 'vitest' }),
}))

vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (handler: any) => handler }))
vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (handler: any) => handler }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { requireGlobalAdmin } = vi.hoisted(() => ({ requireGlobalAdmin: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireGlobalAdmin, auth: requireGlobalAdmin }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findUnique: vi.fn(), create: vi.fn() },
  },
}))

import { POST } from '../route'
import { prisma } from '@/lib/prisma'

function req(body: unknown) {
  return { json: async () => body } as any
}

describe('POST /api/admin/organizations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null as any)
    vi.mocked(prisma.organization.create).mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      industry: null,
      createdAt: new Date(),
    } as any)
  })

  it('returns 403 when caller is not a global admin', async () => {
    requireGlobalAdmin.mockResolvedValue({ user: { id: 'u-1', isGlobalAdmin: false } })
    const res = await POST(req({ name: 'Acme' }))
    expect(res.status).toBe(403)
    expect(prisma.organization.create).not.toHaveBeenCalled()
  })

  it('creates the org (201) for a global admin, deriving a unique slug', async () => {
    requireGlobalAdmin.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
    const res = await POST(req({ name: 'Acme Inc', industry: 'Tech' }))
    expect(res.status).toBe(201)

    expect(prisma.organization.create).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(prisma.organization.create).mock.calls[0][0] as any
    expect(arg.data.name).toBe('Acme Inc')
    expect(arg.data.slug).toBe('acme-inc')
    expect(arg.data.industry).toBe('Tech')
  })

  it('rejects invalid input (empty name) with 400', async () => {
    requireGlobalAdmin.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
    const res = await POST(req({ name: '' }))
    expect(res.status).toBe(400)
    expect(prisma.organization.create).not.toHaveBeenCalled()
  })
})
