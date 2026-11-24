/**
 * Admin CMS pages API: authz (401/403), Zod validation, upsert + audit + revalidation,
 * delete, and 503 while the CMS tables are not migrated.
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
    cmsPage: {
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
const URL_BASE = 'http://localhost/api/admin/cms/pages'
const put = (body: unknown) =>
  new Request(URL_BASE, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
const del = (query: string) => new Request(`${URL_BASE}?${query}`, { method: 'DELETE' })

const VALID = {
  slug: 'terms',
  locale: 'sk',
  title: 'Obchodné podmienky',
  body: '## Úvod\n\nText',
  seoTitle: '',
  seoDescription: 'Popis',
  status: 'PUBLISHED',
}
const missingTable = () =>
  Object.assign(new Error('The table `public.CmsPage` does not exist in the current database.'), {
    code: 'P2021',
  })

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: 'admin-1', isGlobalAdmin: true } })
  p.cmsPage.upsert.mockImplementation(async (args: any) => ({
    id: 'pg1',
    slug: args.create.slug,
    locale: args.create.locale,
    title: args.create.title,
    status: args.create.status,
    publishedAt: args.create.publishedAt,
    updatedAt: new Date(),
  }))
})

describe('authz', () => {
  it('401 anonymous, 403 non-admin, no writes', async () => {
    auth.mockResolvedValue(null)
    expect((await GET(new Request(URL_BASE))).status).toBe(401)
    expect((await PUT(put(VALID))).status).toBe(401)
    expect((await DELETE(del('slug=terms&locale=sk'))).status).toBe(401)

    auth.mockResolvedValue({ user: { id: 'u1', isGlobalAdmin: false } })
    expect((await GET(new Request(URL_BASE))).status).toBe(403)
    expect((await PUT(put(VALID))).status).toBe(403)
    expect((await DELETE(del('slug=terms&locale=sk'))).status).toBe(403)

    expect(p.cmsPage.upsert).not.toHaveBeenCalled()
    expect(p.cmsPage.delete).not.toHaveBeenCalled()
  })
})

describe('validation', () => {
  it.each([
    ['unknown slug', { ...VALID, slug: 'home' }],
    ['unknown locale', { ...VALID, locale: 'fr' }],
    ['empty title', { ...VALID, title: '  ' }],
    ['empty body', { ...VALID, body: '' }],
    ['bad status', { ...VALID, status: 'ARCHIVED' }],
    ['extra field', { ...VALID, publishedAt: '2020-01-01' }],
    ['seo title too long', { ...VALID, seoTitle: 'x'.repeat(121) }],
  ])('400 for %s', async (_label, body) => {
    expect((await PUT(put(body))).status).toBe(400)
    expect(p.cmsPage.upsert).not.toHaveBeenCalled()
  })

  it('400 for a non-JSON body', async () => {
    const res = await PUT(new Request(URL_BASE, { method: 'PUT', body: 'not json' }))
    expect(res.status).toBe(400)
  })

  it('400 for a bad slug or locale on DELETE', async () => {
    expect((await DELETE(del('slug=../etc&locale=sk'))).status).toBe(400)
    expect((await DELETE(del('slug=terms&locale=xx'))).status).toBe(400)
    expect(p.cmsPage.delete).not.toHaveBeenCalled()
  })
})

describe('PUT upsert', () => {
  it('creates a published page: publishedAt set, audit CREATE, all locales revalidated', async () => {
    p.cmsPage.findUnique.mockResolvedValue(null)
    const res = await PUT(put(VALID))
    expect(res.status).toBe(201)

    const args = p.cmsPage.upsert.mock.calls[0][0]
    expect(args.where).toEqual({ slug_locale: { slug: 'terms', locale: 'sk' } })
    expect(args.create.publishedAt).toBeInstanceOf(Date)
    expect(args.create.seoTitle).toBeNull()
    expect(args.create.updatedById).toBe('admin-1')

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', resource: 'CMS_PAGE', resourceId: 'pg1' }),
    )
    const paths = (revalidatePath as any).mock.calls.map((c: any[]) => c[0])
    expect(paths).toEqual(['/sk/terms', '/en/terms', '/de/terms', '/cs/terms', '/pl/terms'])
  })

  it('a new draft has no publishedAt', async () => {
    p.cmsPage.findUnique.mockResolvedValue(null)
    await PUT(put({ ...VALID, status: 'DRAFT' }))
    expect(p.cmsPage.upsert.mock.calls[0][0].create.publishedAt).toBeNull()
  })

  it('an update keeps the first publishedAt and audits the previous state', async () => {
    const first = new Date('2026-01-01T00:00:00Z')
    p.cmsPage.findUnique.mockResolvedValue({
      id: 'pg1',
      slug: 'terms',
      locale: 'sk',
      title: 'Old',
      status: 'PUBLISHED',
      publishedAt: first,
      seoTitle: null,
      seoDescription: null,
      updatedAt: first,
    })
    const res = await PUT(put({ ...VALID, title: 'New' }))
    expect(res.status).toBe(200)
    expect(p.cmsPage.upsert.mock.calls[0][0].update.publishedAt).toBe(first)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE',
        previous: expect.objectContaining({ title: 'Old', status: 'PUBLISHED' }),
      }),
    )
  })

  it('503 with cms_not_migrated when the table is missing', async () => {
    p.cmsPage.findUnique.mockRejectedValue(missingTable())
    const res = await PUT(put(VALID))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('cms_not_migrated')
  })
})

describe('GET / DELETE', () => {
  it('GET lists versions; 503 when not migrated', async () => {
    p.cmsPage.findMany.mockResolvedValue([{ id: 'pg1', slug: 'terms', locale: 'sk' }])
    const ok = await GET(new Request(URL_BASE))
    expect(ok.status).toBe(200)
    expect((await ok.json()).pages).toHaveLength(1)

    p.cmsPage.findMany.mockRejectedValue(missingTable())
    expect((await GET(new Request(URL_BASE))).status).toBe(503)
  })

  it('404 when the version does not exist', async () => {
    p.cmsPage.findUnique.mockResolvedValue(null)
    expect((await DELETE(del('slug=about&locale=en'))).status).toBe(404)
    expect(p.cmsPage.delete).not.toHaveBeenCalled()
  })

  it('deletes, audits and revalidates', async () => {
    p.cmsPage.findUnique.mockResolvedValue({
      id: 'pg2',
      slug: 'about',
      locale: 'en',
      title: 'About',
      status: 'DRAFT',
    })
    const res = await DELETE(del('slug=about&locale=en'))
    expect(res.status).toBe(200)
    expect(p.cmsPage.delete).toHaveBeenCalledWith({
      where: { slug_locale: { slug: 'about', locale: 'en' } },
    })
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DELETE', resource: 'CMS_PAGE', resourceId: 'pg2' }),
    )
    expect(revalidatePath).toHaveBeenCalledWith('/en/about')
  })
})
