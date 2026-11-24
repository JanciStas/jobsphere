/**
 * Admin CMS FAQ API: authz, validation, create/update/delete + audit, reordering,
 * and 503 while the CMS tables are not migrated.
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    cmsFaqItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}))

import { GET, POST } from '../route'
import { PATCH, DELETE } from '../[id]/route'
import { POST as MOVE } from '../[id]/move/route'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit-log'
import { revalidatePath } from 'next/cache'

const p = prisma as any
const ctx = { params: { id: 'f1' } }
const json = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/cms/faq', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const VALID = {
  locale: 'sk',
  category: 'candidates',
  question: 'Je JobSphere zadarmo?',
  answer: 'Pre kandidátov **áno**.',
  published: true,
}
const ITEM = { id: 'f1', locale: 'sk', ...VALID, sortOrder: 0, updatedAt: new Date() }
const missingTable = () =>
  Object.assign(new Error('relation "CmsFaqItem" does not exist'), { code: 'P2021' })

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
  p.$transaction.mockImplementation(async (ops: unknown[]) => ops)
})

describe('authz', () => {
  it('401 anonymous, 403 non-admin, no writes', async () => {
    auth.mockResolvedValue(null)
    expect((await POST(json('POST', VALID))).status).toBe(401)
    expect((await MOVE(json('POST', { direction: 'up' }), ctx)).status).toBe(401)

    auth.mockResolvedValue({ user: { id: 'u1', isGlobalAdmin: false } })
    expect((await GET(new Request('http://localhost/api/admin/cms/faq'))).status).toBe(403)
    expect((await POST(json('POST', VALID))).status).toBe(403)
    expect((await PATCH(json('PATCH', { published: false }), ctx)).status).toBe(403)
    expect((await DELETE(json('DELETE'), ctx)).status).toBe(403)
    expect((await MOVE(json('POST', { direction: 'down' }), ctx)).status).toBe(403)

    expect(p.cmsFaqItem.create).not.toHaveBeenCalled()
    expect(p.cmsFaqItem.update).not.toHaveBeenCalled()
    expect(p.cmsFaqItem.delete).not.toHaveBeenCalled()
  })
})

describe('POST create', () => {
  it.each([
    ['unknown locale', { ...VALID, locale: 'hu' }],
    ['unknown category', { ...VALID, category: 'billing' }],
    ['empty question', { ...VALID, question: ' ' }],
    ['question too long', { ...VALID, question: 'x'.repeat(301) }],
    ['extra field', { ...VALID, sortOrder: 5 }],
  ])('400 for %s', async (_label, body) => {
    expect((await POST(json('POST', body))).status).toBe(400)
    expect(p.cmsFaqItem.create).not.toHaveBeenCalled()
  })

  it('appends after the last entry of the locale, audits and revalidates', async () => {
    p.cmsFaqItem.findFirst.mockResolvedValue({ sortOrder: 4 })
    p.cmsFaqItem.create.mockResolvedValue({ ...ITEM, sortOrder: 5 })
    const res = await POST(json('POST', VALID))
    expect(res.status).toBe(201)
    expect(p.cmsFaqItem.create.mock.calls[0][0].data).toEqual({ ...VALID, sortOrder: 5 })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', resource: 'CMS_FAQ', resourceId: 'f1' }),
    )
    expect(revalidatePath).toHaveBeenCalledWith('/sk/faq')
    expect(revalidatePath).toHaveBeenCalledWith('/pl/faq')
  })

  it('503 with cms_not_migrated when the table is missing', async () => {
    p.cmsFaqItem.findFirst.mockRejectedValue(missingTable())
    const res = await POST(json('POST', VALID))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('cms_not_migrated')
  })
})

describe('PATCH / DELETE', () => {
  it('400 for an empty or invalid patch', async () => {
    expect((await PATCH(json('PATCH', {}), ctx)).status).toBe(400)
    expect((await PATCH(json('PATCH', { category: 'x' }), ctx)).status).toBe(400)
    expect((await PATCH(json('PATCH', { locale: 'en' }), ctx)).status).toBe(400)
  })

  it('404 for an unknown entry', async () => {
    p.cmsFaqItem.findUnique.mockResolvedValue(null)
    expect((await PATCH(json('PATCH', { published: false }), ctx)).status).toBe(404)
    expect((await DELETE(json('DELETE'), ctx)).status).toBe(404)
  })

  it('updates with before/after audit (Next 15 Promise params)', async () => {
    p.cmsFaqItem.findUnique.mockResolvedValue(ITEM)
    p.cmsFaqItem.update.mockResolvedValue({ ...ITEM, published: false })
    const res = await PATCH(json('PATCH', { published: false }), {
      params: Promise.resolve({ id: 'f1' }) as any,
    })
    expect(res.status).toBe(200)
    expect(p.cmsFaqItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'f1' }, data: { published: false } }),
    )
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        previous: { published: true },
        metadata: { locale: 'sk', published: false },
      }),
    )
  })

  it('deletes with the pre-image in the audit log', async () => {
    p.cmsFaqItem.findUnique.mockResolvedValue(ITEM)
    const res = await DELETE(json('DELETE'), ctx)
    expect(res.status).toBe(200)
    expect(p.cmsFaqItem.delete).toHaveBeenCalledWith({ where: { id: 'f1' } })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'DELETE',
        previous: expect.objectContaining({ question: VALID.question }),
      }),
    )
  })
})

describe('move', () => {
  const siblings = [
    { id: 'a', sortOrder: 0 },
    { id: 'f1', sortOrder: 0 },
    { id: 'c', sortOrder: 0 },
  ]

  it('400 for a bad direction', async () => {
    expect((await MOVE(json('POST', { direction: 'left' }), ctx)).status).toBe(400)
  })

  it('moves up and renumbers ties so the swap sticks', async () => {
    p.cmsFaqItem.findUnique.mockResolvedValue({ id: 'f1', locale: 'sk' })
    p.cmsFaqItem.findMany.mockResolvedValue(siblings)
    p.cmsFaqItem.update.mockImplementation(async (args: unknown) => args)

    const res = await MOVE(json('POST', { direction: 'up' }), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).moved).toBe(true)
    const updates = p.cmsFaqItem.update.mock.calls.map((c: any[]) => [
      c[0].where.id,
      c[0].data.sortOrder,
    ])
    // new order f1, a, c → only rows whose sortOrder changes are written
    expect(updates).toEqual([
      ['a', 1],
      ['c', 2],
    ])
    expect(p.$transaction).toHaveBeenCalledTimes(1)
  })

  it('is a no-op at the edge of the list', async () => {
    p.cmsFaqItem.findUnique.mockResolvedValue({ id: 'c', locale: 'sk' })
    p.cmsFaqItem.findMany.mockResolvedValue(siblings)
    const res = await MOVE(json('POST', { direction: 'down' }), { params: { id: 'c' } })
    expect((await res.json()).moved).toBe(false)
    expect(p.$transaction).not.toHaveBeenCalled()
  })
})
