/**
 * Admin announcements API: authz (401/403), validation (400), create/update/delete
 * with audit + cache revalidation, and 503 while the CMS table is not migrated.
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
vi.mock('next/cache', () => ({ revalidateTag: vi.fn(), unstable_cache: (fn: any) => fn }))

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  auth,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    siteAnnouncement: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { GET, POST } from '../route'
import { PATCH, DELETE } from '../[id]/route'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit-log'
import { revalidateTag } from 'next/cache'

const p = (prisma as any).siteAnnouncement
const ctx = { params: { id: 'ann1' } }
const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/cms/announcements', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const ROW = {
  id: 'ann1',
  message: { sk: 'Odstávka v noci' },
  linkUrl: null,
  linkLabel: {},
  variant: 'warning',
  audience: 'all',
  startsAt: null,
  endsAt: null,
  active: false,
  dismissible: true,
  createdAt: new Date('2026-11-20T10:00:00Z'),
  updatedAt: new Date('2026-11-20T10:00:00Z'),
}

const tableMissing = () =>
  Object.assign(new Error('The table `public.SiteAnnouncement` does not exist'), {
    code: 'P2021',
  })

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
})

describe('authz', () => {
  it('401 for anonymous callers, 403 for non-admins, and nothing is written', async () => {
    auth.mockResolvedValue(null)
    expect((await GET(req('GET'))).status).toBe(401)
    expect((await POST(req('POST', { message: { sk: 'a' } }))).status).toBe(401)
    expect((await PATCH(req('PATCH', { active: true }), ctx)).status).toBe(401)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(401)

    auth.mockResolvedValue({ user: { id: 'u1', isGlobalAdmin: false } })
    expect((await GET(req('GET'))).status).toBe(403)
    expect((await POST(req('POST', { message: { sk: 'a' } }))).status).toBe(403)
    expect((await PATCH(req('PATCH', { active: true }), ctx)).status).toBe(403)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(403)

    expect(p.create).not.toHaveBeenCalled()
    expect(p.update).not.toHaveBeenCalled()
    expect(p.delete).not.toHaveBeenCalled()
  })
})

describe('validation', () => {
  it.each([
    ['missing sk', { message: { en: 'Hello' } }],
    ['javascript: link', { message: { sk: 'a' }, linkUrl: 'javascript:alert(1)' }],
    [
      'endsAt before startsAt',
      { message: { sk: 'a' }, startsAt: '2026-12-02T10:00', endsAt: '2026-12-01T10:00' },
    ],
    ['message too long', { message: { sk: 'x'.repeat(301) } }],
    ['unknown variant', { message: { sk: 'a' }, variant: 'danger' }],
    ['unknown field', { message: { sk: 'a' }, orgId: 'o1' }],
  ])('POST 400: %s', async (_name, body) => {
    const res = await POST(req('POST', body))
    expect(res.status).toBe(400)
    expect(p.create).not.toHaveBeenCalled()
  })

  it('POST 400 on a non-JSON body', async () => {
    const res = await POST(
      new Request('http://localhost/api/admin/cms/announcements', {
        method: 'POST',
        body: 'not json',
      }),
    )
    expect(res.status).toBe(400)
  })

  it('PATCH 400 when the merged window ends before it starts', async () => {
    p.findUnique.mockResolvedValue({ ...ROW, startsAt: new Date('2026-12-05T09:00:00Z') })
    const res = await PATCH(req('PATCH', { endsAt: '2026-12-01T10:00' }), ctx)
    expect(res.status).toBe(400)
    expect(p.update).not.toHaveBeenCalled()
  })

  it('PATCH 400 for a javascript: link and for an empty body', async () => {
    expect((await PATCH(req('PATCH', { linkUrl: 'javascript:void(0)' }), ctx)).status).toBe(400)
    expect((await PATCH(req('PATCH', {}), ctx)).status).toBe(400)
    expect(p.update).not.toHaveBeenCalled()
  })
})

describe('create', () => {
  it('creates, audits and revalidates the announcements tag', async () => {
    p.create.mockResolvedValue(ROW)
    const res = await POST(
      req('POST', {
        message: { sk: 'Odstávka v noci', en: '' },
        linkUrl: 'https://status.example.com',
        linkLabel: { sk: 'Stav' },
        variant: 'warning',
        startsAt: '2026-12-01T22:00',
        endsAt: '2026-12-02T02:00',
        active: true,
      }),
    )
    expect(res.status).toBe(201)

    const data = p.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      message: { sk: 'Odstávka v noci' },
      linkUrl: 'https://status.example.com',
      linkLabel: { sk: 'Stav' },
      variant: 'warning',
      audience: 'all',
      active: true,
      dismissible: true,
    })
    // datetime-local values are Slovak time (CET in December → UTC+1).
    expect(data.startsAt.toISOString()).toBe('2026-12-01T21:00:00.000Z')
    expect(data.endsAt.toISOString()).toBe('2026-12-02T01:00:00.000Z')

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'CREATE',
        resource: 'ANNOUNCEMENT',
        resourceId: 'ann1',
      }),
    )
    expect(revalidateTag).toHaveBeenCalledWith('announcements')
  })

  it('GET lists announcements', async () => {
    p.findMany.mockResolvedValue([ROW])
    const res = await GET(req('GET'))
    expect(res.status).toBe(200)
    expect((await res.json()).announcements).toHaveLength(1)
  })
})

describe('update and delete', () => {
  it('PATCH toggles active, audits before/after and revalidates', async () => {
    p.findUnique.mockResolvedValue(ROW)
    p.update.mockResolvedValue({ ...ROW, active: true })
    const res = await PATCH(req('PATCH', { active: true }), {
      params: Promise.resolve({ id: 'ann1' }),
    } as any)
    expect(res.status).toBe(200)
    expect(p.update).toHaveBeenCalledWith({ where: { id: 'ann1' }, data: { active: true } })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        resource: 'ANNOUNCEMENT',
        resourceId: 'ann1',
        previous: { active: false },
        metadata: { active: true },
      }),
    )
    expect(revalidateTag).toHaveBeenCalledWith('announcements')
  })

  it('PATCH clears link labels when the link is removed', async () => {
    p.findUnique.mockResolvedValue({ ...ROW, linkUrl: '/sk/jobs', linkLabel: { sk: 'Ponuky' } })
    p.update.mockResolvedValue(ROW)
    await PATCH(req('PATCH', { linkUrl: '' }), ctx)
    expect(p.update.mock.calls[0][0].data).toEqual({ linkUrl: null, linkLabel: {} })
  })

  it('404 for an unknown id', async () => {
    p.findUnique.mockResolvedValue(null)
    expect((await PATCH(req('PATCH', { active: true }), ctx)).status).toBe(404)
    expect((await DELETE(req('DELETE'), ctx)).status).toBe(404)
    expect(p.update).not.toHaveBeenCalled()
    expect(p.delete).not.toHaveBeenCalled()
  })

  it('DELETE removes the row, keeps the pre-image in the audit log and revalidates', async () => {
    p.findUnique.mockResolvedValue(ROW)
    p.delete.mockResolvedValue(ROW)
    const res = await DELETE(req('DELETE'), ctx)
    expect(res.status).toBe(200)
    expect(p.delete).toHaveBeenCalledWith({ where: { id: 'ann1' } })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        resource: 'ANNOUNCEMENT',
        resourceId: 'ann1',
        previous: expect.objectContaining({ message: { sk: 'Odstávka v noci' } }),
      }),
    )
    expect(revalidateTag).toHaveBeenCalledWith('announcements')
  })
})

describe('table not migrated', () => {
  it('responds 503 with the not-migrated body on every handler', async () => {
    p.findMany.mockRejectedValue(tableMissing())
    p.create.mockRejectedValue(tableMissing())
    p.findUnique.mockRejectedValue(tableMissing())

    for (const res of [
      await GET(req('GET')),
      await POST(req('POST', { message: { sk: 'a' } })),
      await PATCH(req('PATCH', { active: true }), ctx),
      await DELETE(req('DELETE'), ctx),
    ]) {
      expect(res.status).toBe(503)
      expect(await res.json()).toMatchObject({ code: 'cms_not_migrated' })
    }
    expect(createAuditLog).not.toHaveBeenCalled()
    expect(revalidateTag).not.toHaveBeenCalled()
  })
})
