/**
 * Admin CMS site-texts API: authz, whitelist + plain-text validation, upsert/reset with
 * audit and revalidation, and 503 while the CMS tables are not migrated.
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
    cmsText: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { GET, PUT, DELETE } from '../route'
import { prisma } from '@/lib/prisma'
import { createAuditLog } from '@/lib/audit-log'
import { revalidatePath } from 'next/cache'

const p = prisma as any
const URL_BASE = 'http://localhost/api/admin/cms/texts'
const put = (body: unknown) =>
  new Request(URL_BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const del = (query: string) => new Request(`${URL_BASE}?${query}`, { method: 'DELETE' })
const VALID = { key: 'pricing.title', locale: 'sk', value: 'Jednoduchý cenník' }

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
  p.cmsText.upsert.mockImplementation(async (args: any) => ({
    id: 't1',
    ...args.create,
    updatedAt: new Date(),
  }))
})

describe('authz', () => {
  it('401 anonymous, 403 non-admin, no writes', async () => {
    auth.mockResolvedValue(null)
    expect((await PUT(put(VALID))).status).toBe(401)
    expect((await DELETE(del('key=pricing.title&locale=sk'))).status).toBe(401)

    auth.mockResolvedValue({ user: { id: 'u1', isGlobalAdmin: false } })
    expect((await GET(new Request(URL_BASE))).status).toBe(403)
    expect((await PUT(put(VALID))).status).toBe(403)
    expect((await DELETE(del('key=pricing.title&locale=sk'))).status).toBe(403)

    expect(p.cmsText.upsert).not.toHaveBeenCalled()
    expect(p.cmsText.delete).not.toHaveBeenCalled()
  })
})

describe('validation', () => {
  it.each([
    ['a key outside the whitelist', { ...VALID, key: 'auth.login.title' }],
    ['a prototype key', { ...VALID, key: '__proto__' }],
    ['an unknown locale', { ...VALID, locale: 'it' }],
    ['an empty value', { ...VALID, value: '   ' }],
    ['a value over 500 chars', { ...VALID, value: 'x'.repeat(501) }],
    ['HTML in the value', { ...VALID, value: 'Ahoj <script>alert(1)</script>' }],
    ['an HTML tag in the value', { ...VALID, value: '<b>tučné</b>' }],
    ['control characters', { ...VALID, value: 'a\u0000b' }],
  ])('400 for %s', async (_label, body) => {
    expect((await PUT(put(body))).status).toBe(400)
    expect(p.cmsText.upsert).not.toHaveBeenCalled()
  })

  it('accepts plain text with comparison signs', async () => {
    p.cmsText.findUnique.mockResolvedValue(null)
    expect((await PUT(put({ ...VALID, value: 'Viac ako 3 < 5 > 1 dní' }))).status).toBe(201)
  })

  it('400 for a non-whitelisted key on DELETE', async () => {
    expect((await DELETE(del('key=nav.home&locale=sk'))).status).toBe(400)
    expect(p.cmsText.findUnique).not.toHaveBeenCalled()
  })

  it('400 for a bad locale filter on GET', async () => {
    expect((await GET(new Request(`${URL_BASE}?locale=ru`))).status).toBe(400)
  })
})

describe('PUT / DELETE', () => {
  it('creates an override, audits CREATE and revalidates the pricing page in all locales', async () => {
    p.cmsText.findUnique.mockResolvedValue(null)
    const res = await PUT(put(VALID))
    expect(res.status).toBe(201)
    expect(p.cmsText.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key_locale: { key: 'pricing.title', locale: 'sk' } },
        create: {
          key: 'pricing.title',
          locale: 'sk',
          value: 'Jednoduchý cenník',
          updatedById: 'admin-1',
        },
      }),
    )
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', resource: 'CMS_TEXT' }),
    )
    const paths = (revalidatePath as any).mock.calls.map((c: any[]) => c[0])
    expect(paths).toEqual([
      '/sk/pricing',
      '/en/pricing',
      '/de/pricing',
      '/cs/pricing',
      '/pl/pricing',
    ])
  })

  it('an update audits the previous value; home keys revalidate the home page', async () => {
    p.cmsText.findUnique.mockResolvedValue({ id: 't1', value: 'Starý' })
    const res = await PUT(put({ key: 'hero.title', locale: 'en', value: 'New' }))
    expect(res.status).toBe(200)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE', previous: { value: 'Starý' } }),
    )
    expect(revalidatePath).toHaveBeenCalledWith('/en')
  })

  it('reset deletes an existing override with an audit entry', async () => {
    p.cmsText.findUnique.mockResolvedValue({ id: 't1', value: 'Vlastný' })
    const res = await DELETE(del('key=forEmployers.hero.title&locale=de'))
    expect(res.status).toBe(200)
    expect((await res.json()).reset).toBe(true)
    expect(p.cmsText.delete).toHaveBeenCalledWith({
      where: { key_locale: { key: 'forEmployers.hero.title', locale: 'de' } },
    })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', resource: 'CMS_TEXT' }),
    )
    expect(revalidatePath).toHaveBeenCalledWith('/de/for-employers')
  })

  it('reset is idempotent when there is no override', async () => {
    p.cmsText.findUnique.mockResolvedValue(null)
    const res = await DELETE(del('key=hero.title&locale=sk'))
    expect(res.status).toBe(200)
    expect((await res.json()).reset).toBe(false)
    expect(p.cmsText.delete).not.toHaveBeenCalled()
    expect(createAuditLog).not.toHaveBeenCalled()
  })

  it('503 with cms_not_migrated when the table is missing', async () => {
    p.cmsText.findUnique.mockRejectedValue(
      Object.assign(new Error('The table `public.CmsText` does not exist'), { code: 'P2021' }),
    )
    const res = await PUT(put(VALID))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('cms_not_migrated')
  })
})
