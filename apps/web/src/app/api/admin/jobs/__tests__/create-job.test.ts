/**
 * Superadmin job creation (POST /api/admin/jobs).
 * Pins the authz guard (403), org validation (404), and happy path (201) where
 * createdBy = the admin and orgId comes from the request body.
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
    organization: { findFirst: vi.fn() },
    job: { create: vi.fn() },
  },
}))

import { POST } from '../route'
import { prisma } from '@/lib/prisma'

const VALID_BODY = {
  orgId: 'org-1',
  title: 'Senior Engineer',
  description: 'a'.repeat(60),
  workMode: 'REMOTE',
}

function req(body: unknown) {
  return { json: async () => body } as any
}

describe('POST /api/admin/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ id: 'org-1' } as any)
    vi.mocked(prisma.job.create).mockResolvedValue({
      id: 'job-1',
      title: 'Senior Engineer',
      status: 'PUBLISHED',
      orgId: 'org-1',
      createdAt: new Date(),
    } as any)
  })

  it('returns 403 when caller is not a global admin', async () => {
    requireGlobalAdmin.mockResolvedValue({ user: { id: 'u-1', isGlobalAdmin: false } })
    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(403)
    expect(prisma.job.create).not.toHaveBeenCalled()
  })

  it('returns 401 when signed out', async () => {
    requireGlobalAdmin.mockResolvedValue(null)
    expect((await POST(req(VALID_BODY))).status).toBe(401)
  })

  it('rejects salaryMin above salaryMax with 400', async () => {
    requireGlobalAdmin.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
    const res = await POST(req({ ...VALID_BODY, salaryMin: 5000, salaryMax: 3000 }))
    expect(res.status).toBe(400)
    expect(prisma.job.create).not.toHaveBeenCalled()
  })

  it('returns 404 when the target org does not exist / is suspended', async () => {
    requireGlobalAdmin.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null as any)
    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(404)
    expect(prisma.job.create).not.toHaveBeenCalled()
  })

  it('creates the job (201) with createdBy = admin and orgId from body', async () => {
    requireGlobalAdmin.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
    const res = await POST(req(VALID_BODY))
    expect(res.status).toBe(201)

    expect(prisma.job.create).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(prisma.job.create).mock.calls[0][0] as any
    expect(arg.data.orgId).toBe('org-1')
    expect(arg.data.createdBy).toBe('admin-1')
    expect(arg.data.remote).toBe(true)
    expect(arg.data.status).toBe('PUBLISHED')
  })

  it('rejects a too-short description with 400', async () => {
    requireGlobalAdmin.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
    const res = await POST(req({ ...VALID_BODY, description: 'too short' }))
    expect(res.status).toBe(400)
    expect(prisma.job.create).not.toHaveBeenCalled()
  })
})
