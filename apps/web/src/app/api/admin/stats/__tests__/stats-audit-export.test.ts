/** authZ for GET /api/admin/stats and GET /api/admin/audit/export. */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({
  createAuditLog: vi.fn(),
  getRequestMetadata: () => ({ ipAddress: '127.0.0.1', userAgent: 'vitest' }),
}))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: any) => h }))

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth }))

vi.mock('@/lib/admin/overview', () => ({
  getAdminKpis: vi.fn().mockResolvedValue({ users: 5 }),
  getAttentionCounts: vi.fn().mockResolvedValue({ pastDue: 0 }),
}))
vi.mock('@/lib/admin/audit-query', async (orig) => ({
  ...((await orig()) as object),
  queryAuditExport: vi.fn().mockResolvedValue([
    {
      createdAt: new Date('2026-01-01T00:00:00Z'),
      userId: 'a',
      userEmail: 'a@b.sk',
      action: 'BAN',
      entityType: 'USER',
      entityId: 'u',
      ipAddress: '1.1.1.1',
      oldValues: null,
      newValues: { password: 'x', ok: 1 },
    },
  ]),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { GET as stats } from '../route'
import { GET as exportCsv } from '../../audit/export/route'
import { createAuditLog } from '@/lib/audit-log'

const req = (p: string) => new Request(`http://localhost${p}`)

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: 'a1', isGlobalAdmin: true } })
})

describe.each([
  ['stats', () => stats(req('/api/admin/stats'))],
  ['audit export', () => exportCsv(req('/api/admin/audit/export'))],
])('%s authZ', (_n, call) => {
  it('401 anonymous', async () => {
    auth.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })
  it('403 non-admin', async () => {
    auth.mockResolvedValue({ user: { id: 'u', isGlobalAdmin: false } })
    expect((await call()).status).toBe(403)
  })
})

describe('success paths', () => {
  it('stats returns counts', async () => {
    const res = await stats(req('/api/admin/stats'))
    expect(res.status).toBe(200)
    expect((await res.json()).kpis.users).toBe(5)
  })
  it('export returns redacted CSV without user agent and audits the export', async () => {
    const res = await exportCsv(req('/api/admin/audit/export?action=BAN'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    const body = await res.text()
    expect(body).toContain('BAN')
    expect(body).toContain('[redacted]')
    expect(body).not.toContain('"x"')
    expect(body.toLowerCase()).not.toContain('useragent')
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DATA_EXPORTED' }),
    )
  })
})
