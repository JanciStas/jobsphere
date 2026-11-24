/**
 * Employer career page API: org comes only from the session, only ORG_ADMIN of a live
 * (non-suspended) org may write, input is strictly validated, and a missing CMS table
 * degrades to 503 instead of 500.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (handler: any) => handler }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (handler: any) => handler }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth, UnauthorizedError: class extends Error {} }))

const { revalidatePath } = vi.hoisted(() => ({ revalidatePath: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath }))

const { createAuditLog } = vi.hoisted(() => ({ createAuditLog: vi.fn() }))
vi.mock('@/lib/audit-log', () => ({
  createAuditLog,
  getRequestMetadata: () => ({ ipAddress: '1.2.3.4', userAgent: 'vitest' }),
}))

const { storeCmsImage } = vi.hoisted(() => ({ storeCmsImage: vi.fn() }))
vi.mock('@/lib/cms/image-upload', () => ({ storeCmsImage }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userOrgRole: { findFirst: vi.fn() },
    careerPage: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}))

import { GET, PUT } from '../route'
import { POST as UPLOAD } from '../upload/route'
import { prisma } from '@/lib/prisma'

const ORG = 'org-1'
const ME = 'user-1'
const url = 'http://localhost:3000/api/employer/career-page'

function membership(role: string, deletedAt: Date | null = null) {
  return {
    userId: ME,
    orgId: ORG,
    role,
    deletedAt: null,
    organization: { id: ORG, slug: 'acme', deletedAt },
  }
}

const STORED = {
  id: 'cp-1',
  orgId: ORG,
  published: false,
  headline: 'Old headline',
  subheadline: null,
  about: null,
  benefits: [],
  coverImage: null,
  brandColor: null,
  videoUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const put = (body: unknown) =>
  new Request(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

const valid = {
  published: true,
  headline: 'Build with us',
  subheadline: 'Great team',
  about: '## Hello',
  benefits: ['Home office', 'Meal vouchers'],
  coverImage: 'https://x.public.blob.vercel-storage.com/career/org-1/a.png',
  brandColor: '#1a2b3c',
  videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
}

const missingTable = Object.assign(new Error('The table `public.CareerPage` does not exist'), {
  code: 'P2021',
})

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: ME, activeOrgId: ORG } })
  ;(prisma.userOrgRole.findFirst as any).mockResolvedValue(membership('ORG_ADMIN'))
  ;(prisma.careerPage.findUnique as any).mockResolvedValue(STORED)
  ;(prisma.careerPage.upsert as any).mockImplementation(async (args: any) => ({
    ...STORED,
    ...args.update,
  }))
})

describe('GET /api/employer/career-page', () => {
  it('401 when unauthenticated', async () => {
    auth.mockResolvedValue(null)
    const res = await GET(new Request(url))
    expect(res.status).toBe(401)
  })

  it('returns defaults when nothing is saved, read-only for a recruiter', async () => {
    ;(prisma.userOrgRole.findFirst as any).mockResolvedValue(membership('RECRUITER'))
    ;(prisma.careerPage.findUnique as any).mockResolvedValue(null)
    const res = await GET(new Request(url))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ canEdit: false, exists: false, slug: 'acme' })
    expect(body.page).toMatchObject({ published: false, benefits: [] })
    expect(prisma.careerPage.findUnique).toHaveBeenCalledWith({ where: { orgId: ORG } })
  })

  it('403 for a suspended org', async () => {
    ;(prisma.userOrgRole.findFirst as any).mockResolvedValue(
      membership('ORG_ADMIN', new Date('2026-11-01')),
    )
    const res = await GET(new Request(url))
    expect(res.status).toBe(403)
    expect(prisma.careerPage.findUnique).not.toHaveBeenCalled()
  })

  it('404 without an active membership', async () => {
    ;(prisma.userOrgRole.findFirst as any).mockResolvedValue(null)
    const res = await GET(new Request(url))
    expect(res.status).toBe(404)
  })

  it('503 when the CareerPage table is missing', async () => {
    ;(prisma.careerPage.findUnique as any).mockRejectedValue(missingTable)
    const res = await GET(new Request(url))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('cms_not_migrated')
  })
})

describe('PUT /api/employer/career-page', () => {
  it('401 when unauthenticated', async () => {
    auth.mockResolvedValue(null)
    expect((await PUT(put(valid))).status).toBe(401)
    expect(prisma.careerPage.upsert).not.toHaveBeenCalled()
  })

  it.each(['RECRUITER', 'HIRING_MANAGER', 'AGENCY'])('403 for %s', async (role) => {
    ;(prisma.userOrgRole.findFirst as any).mockResolvedValue(membership(role))
    expect((await PUT(put(valid))).status).toBe(403)
    expect(prisma.careerPage.upsert).not.toHaveBeenCalled()
  })

  it('403 for an admin of a suspended org', async () => {
    ;(prisma.userOrgRole.findFirst as any).mockResolvedValue(
      membership('ORG_ADMIN', new Date('2026-11-01')),
    )
    expect((await PUT(put(valid))).status).toBe(403)
    expect(prisma.careerPage.upsert).not.toHaveBeenCalled()
  })

  it('resolves the org from the session only; only live memberships count', async () => {
    await PUT(put(valid))
    const where = (prisma.userOrgRole.findFirst as any).mock.calls[0][0].where
    expect(where).toMatchObject({ userId: ME, orgId: ORG, deletedAt: null })
  })

  it('ignores an orgId in the body and writes the caller org', async () => {
    const res = await PUT(put({ ...valid, orgId: 'victim-org' }))
    expect(res.status).toBe(200)
    const args = (prisma.careerPage.upsert as any).mock.calls[0][0]
    expect(args.where).toEqual({ orgId: ORG })
    expect(args.create.orgId).toBe(ORG)
    expect(args.update).not.toHaveProperty('orgId')
    expect(JSON.stringify(args)).not.toContain('victim-org')
  })

  it.each([
    ['bad hex color', { brandColor: '#12345' }],
    ['css injection in color', { brandColor: '#123456;background:url(x)' }],
    ['javascript: cover image', { coverImage: 'javascript:alert(1)' }],
    ['http cover image', { coverImage: 'http://example.com/a.png' }],
    ['non-YouTube video', { videoUrl: 'https://evil.com/watch?v=dQw4w9WgXcQ' }],
    ['javascript: video', { videoUrl: 'javascript:alert(1)' }],
    ['too many benefits', { benefits: Array.from({ length: 13 }, (_, i) => `B${i}`) }],
    ['benefit too long', { benefits: ['x'.repeat(121)] }],
    ['headline too long', { headline: 'x'.repeat(121) }],
    ['subheadline too long', { subheadline: 'x'.repeat(241) }],
    ['about too long', { about: 'x'.repeat(20_001) }],
    ['published not boolean', { published: 'yes' }],
  ])('400 for %s', async (_label, patch) => {
    const res = await PUT(put({ ...valid, ...patch }))
    expect(res.status).toBe(400)
    expect(prisma.careerPage.upsert).not.toHaveBeenCalled()
  })

  it('400 for a malformed JSON body', async () => {
    expect((await PUT(put('{not json'))).status).toBe(400)
  })

  it('upserts, audits with previous values and revalidates the public page', async () => {
    const res = await PUT(put(valid))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toMatchObject({ headline: 'Build with us', brandColor: '#1a2b3c' })
    // The original URL is stored; the embed URL is derived at render time.
    expect(body.page.videoUrl).toBe('https://youtu.be/dQw4w9WgXcQ')

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ME,
        orgId: ORG,
        action: 'UPDATE',
        resource: 'CAREER_PAGE',
        resourceId: 'cp-1',
        previous: expect.objectContaining({ headline: 'Old headline', published: false }),
        metadata: expect.objectContaining({ headline: 'Build with us', published: true }),
      }),
    )
    expect(revalidatePath).toHaveBeenCalledWith('/sk/careers/acme')
    expect(revalidatePath).toHaveBeenCalledWith('/en/careers/acme')
    expect(revalidatePath).toHaveBeenCalledWith(`/sk/company/${ORG}`)
  })

  it('first save is a CREATE without previous values', async () => {
    ;(prisma.careerPage.findUnique as any).mockResolvedValue(null)
    await PUT(put(valid))
    const entry = createAuditLog.mock.calls[0][0]
    expect(entry.action).toBe('CREATE')
    expect(entry.previous).toBeUndefined()
    const args = (prisma.careerPage.upsert as any).mock.calls[0][0]
    expect(args.create).toMatchObject({ orgId: ORG, published: true, benefits: valid.benefits })
  })

  it('only writes the keys that were sent', async () => {
    await PUT(put({ headline: 'Only this' }))
    const args = (prisma.careerPage.upsert as any).mock.calls[0][0]
    expect(args.update).toEqual({ headline: 'Only this' })
  })

  it('503 when the CareerPage table is missing', async () => {
    ;(prisma.careerPage.findUnique as any).mockRejectedValue(missingTable)
    const res = await PUT(put(valid))
    expect(res.status).toBe(503)
    expect(createAuditLog).not.toHaveBeenCalled()
  })
})

describe('POST /api/employer/career-page/upload', () => {
  const upload = () => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }))
    return new Request(`${url}/upload`, { method: 'POST', body: form })
  }

  it('401 when unauthenticated', async () => {
    auth.mockResolvedValue(null)
    expect((await UPLOAD(upload())).status).toBe(401)
    expect(storeCmsImage).not.toHaveBeenCalled()
  })

  it.each(['RECRUITER', 'HIRING_MANAGER'])('403 for %s', async (role) => {
    ;(prisma.userOrgRole.findFirst as any).mockResolvedValue(membership(role))
    expect((await UPLOAD(upload())).status).toBe(403)
    expect(storeCmsImage).not.toHaveBeenCalled()
  })

  it('403 for a suspended org', async () => {
    ;(prisma.userOrgRole.findFirst as any).mockResolvedValue(
      membership('ORG_ADMIN', new Date('2026-11-01')),
    )
    expect((await UPLOAD(upload())).status).toBe(403)
    expect(storeCmsImage).not.toHaveBeenCalled()
  })

  it('stores under career/<session org> and audits', async () => {
    storeCmsImage.mockResolvedValue({ ok: true, url: 'https://blob/career/org-1/a.jpg' })
    const res = await UPLOAD(upload())
    expect(res.status).toBe(200)
    expect((await res.json()).url).toBe('https://blob/career/org-1/a.jpg')
    expect(storeCmsImage.mock.calls[0][1]).toBe(`career/${ORG}`)
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG, resource: 'CMS_UPLOAD' }),
    )
  })

  it('passes validation errors through', async () => {
    storeCmsImage.mockResolvedValue({
      ok: false,
      status: 400,
      code: 'invalid_type',
      error: 'Invalid image type. Use JPG, PNG or WEBP.',
    })
    const res = await UPLOAD(upload())
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_type')
  })
})
