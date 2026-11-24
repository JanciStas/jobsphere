/**
 * Admin blog API (api/admin/cms/blog/**): authz (401/403), Zod validation (400),
 * duplicate slug (409), publish semantics (publishedAt), missing CMS tables (503).
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
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { authMock } = vi.hoisted(() => ({ authMock: vi.fn() }))
vi.mock('@/lib/auth', () => ({ auth: authMock }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    blogPost: {
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    blogCategory: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { GET as listPosts, POST as createPost } from '../posts/route'
import { PATCH as patchPost, DELETE as deletePost } from '../posts/[id]/route'
import { POST as createCategory, PUT as reorderCategories } from '../categories/route'
import { PATCH as patchCategory } from '../categories/[id]/route'
import { prisma } from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { createAuditLog } from '@/lib/audit-log'

const ADMIN = { user: { id: 'admin-1', isGlobalAdmin: true } }
const VALID = {
  locale: 'sk',
  title: 'Ako napísať dobré CV',
  slug: 'ako-napisat-dobre-cv',
  excerpt: 'Krátky perex',
  body: '## Úvod\n\nText článku.',
  tags: ['cv', 'kariéra'],
}

function req(body: unknown, url = 'http://localhost/api/admin/cms/blog/posts') {
  return { url, json: async () => body, headers: new Headers() } as any
}
/** Next 15 passes params as a Promise. */
const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as any

const tableMissing = () =>
  Object.assign(new Error('The table `public.BlogPost` does not exist'), { code: 'P2021' })

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue(ADMIN)
  vi.mocked(prisma.blogPost.create).mockImplementation(
    async ({ data }: any) => ({ id: 'post-1', updatedAt: new Date(), ...data }) as any,
  )
  vi.mocked(prisma.blogPost.update).mockImplementation(
    async ({ data }: any) => ({ id: 'post-1', slug: 'old', locale: 'sk', ...data }) as any,
  )
  vi.mocked(prisma.blogCategory.findUnique).mockResolvedValue({ id: 'cat-1' } as any)
})

describe('auth', () => {
  it('401 when signed out', async () => {
    authMock.mockResolvedValue(null)
    expect((await createPost(req(VALID))).status).toBe(401)
    expect((await listPosts(req(null))).status).toBe(401)
    expect((await patchPost(req({ title: 'x' }), ctx('post-1'))).status).toBe(401)
    expect((await deletePost(req(null), ctx('post-1'))).status).toBe(401)
    expect((await createCategory(req({ slug: 'a', names: { sk: 'A' } }))).status).toBe(401)
    expect(prisma.blogPost.create).not.toHaveBeenCalled()
  })

  it('403 for a signed-in non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u-1', isGlobalAdmin: false } })
    expect((await createPost(req(VALID))).status).toBe(403)
    expect((await deletePost(req(null), ctx('post-1'))).status).toBe(403)
    expect((await reorderCategories(req({ order: ['a'] }))).status).toBe(403)
    expect(prisma.blogPost.create).not.toHaveBeenCalled()
    expect(prisma.blogPost.delete).not.toHaveBeenCalled()
  })
})

describe('POST /posts validation', () => {
  it.each([
    ['unsupported locale', { locale: 'fr' }],
    ['bad slug', { slug: 'Ako Napísať' }],
    ['slug too long', { slug: 'a'.repeat(121) }],
    ['title too long', { title: 'x'.repeat(201) }],
    ['excerpt too long', { excerpt: 'x'.repeat(501) }],
    ['body too long', { body: 'x'.repeat(100_001) }],
    ['http cover image', { coverImage: 'http://example.com/a.png' }],
    ['javascript cover image', { coverImage: 'javascript:alert(1)' }],
    ['too many tags', { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }],
    ['tag too long', { tags: ['x'.repeat(41)] }],
    ['unknown field', { authorId: 'someone-else' }],
  ])('400 for %s', async (_label, patch) => {
    const res = await createPost(req({ ...VALID, ...patch }))
    expect(res.status).toBe(400)
    expect(prisma.blogPost.create).not.toHaveBeenCalled()
  })

  it('400 for a malformed JSON body', async () => {
    const bad = { url: 'http://x', json: async () => Promise.reject(new SyntaxError('x')) } as any
    expect((await createPost(bad)).status).toBe(400)
  })

  it('400 when the category does not exist', async () => {
    vi.mocked(prisma.blogCategory.findUnique).mockResolvedValue(null)
    const res = await createPost(req({ ...VALID, categoryId: 'missing' }))
    expect(res.status).toBe(400)
    expect(prisma.blogPost.create).not.toHaveBeenCalled()
  })
})

describe('POST /posts', () => {
  it('creates a draft without publishedAt, with the admin as author', async () => {
    const res = await createPost(req(VALID))
    expect(res.status).toBe(201)
    const { data } = vi.mocked(prisma.blogPost.create).mock.calls[0][0] as any
    expect(data.status).toBe('DRAFT')
    expect(data.publishedAt).toBeNull()
    expect(data.authorId).toBe('admin-1')
    expect(data.coverImage).toBeNull()
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE', resource: 'BLOG_POST' }),
    )
    expect(revalidatePath).toHaveBeenCalledWith('/[locale]/blog', 'page')
    expect(revalidatePath).toHaveBeenCalledWith('/sk/blog/ako-napisat-dobre-cv')
  })

  it('publishing without a date sets publishedAt to now', async () => {
    const before = Date.now()
    await createPost(req({ ...VALID, status: 'PUBLISHED' }))
    const { data } = vi.mocked(prisma.blogPost.create).mock.calls[0][0] as any
    expect(data.status).toBe('PUBLISHED')
    expect(data.publishedAt).toBeInstanceOf(Date)
    expect(data.publishedAt.getTime()).toBeGreaterThanOrEqual(before)
    expect(data.publishedAt.getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('keeps a future publishedAt (scheduled post)', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    await createPost(req({ ...VALID, status: 'PUBLISHED', publishedAt: future }))
    const { data } = vi.mocked(prisma.blogPost.create).mock.calls[0][0] as any
    expect(data.publishedAt.toISOString()).toBe(future)
  })

  it('409 when slug+locale already exists', async () => {
    vi.mocked(prisma.blogPost.create).mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    )
    const res = await createPost(req(VALID))
    expect(res.status).toBe(409)
  })

  it('503 when the CMS tables are missing', async () => {
    vi.mocked(prisma.blogPost.create).mockRejectedValue(tableMissing())
    const res = await createPost(req(VALID))
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('cms_not_migrated')
  })

  it('GET list also answers 503 when the tables are missing', async () => {
    vi.mocked(prisma.blogPost.findMany).mockRejectedValue(tableMissing())
    vi.mocked(prisma.blogPost.count).mockRejectedValue(tableMissing())
    expect((await listPosts(req(null))).status).toBe(503)
  })
})

describe('GET /posts filters', () => {
  it('SCHEDULED filter = PUBLISHED with a future date', async () => {
    vi.mocked(prisma.blogPost.findMany).mockResolvedValue([])
    vi.mocked(prisma.blogPost.count).mockResolvedValue(0)
    await listPosts(
      req(null, 'http://localhost/api/admin/cms/blog/posts?status=SCHEDULED&locale=en'),
    )
    const { where } = vi.mocked(prisma.blogPost.findMany).mock.calls[0][0] as any
    expect(where.locale).toBe('en')
    expect(where.status).toBe('PUBLISHED')
    expect(where.publishedAt.gt).toBeInstanceOf(Date)
  })
})

describe('PATCH /posts/[id]', () => {
  it('404 for an unknown post', async () => {
    vi.mocked(prisma.blogPost.findUnique).mockResolvedValue(null)
    expect((await patchPost(req({ title: 'Nový' }), ctx('nope'))).status).toBe(404)
  })

  it('publishing a draft with no date sets publishedAt', async () => {
    vi.mocked(prisma.blogPost.findUnique).mockResolvedValue({
      id: 'post-1',
      slug: 'old',
      locale: 'sk',
      status: 'DRAFT',
      publishedAt: null,
      authorId: 'admin-0',
    } as any)
    const res = await patchPost(req({ status: 'PUBLISHED' }), ctx('post-1'))
    expect(res.status).toBe(200)
    const call = vi.mocked(prisma.blogPost.update).mock.calls[0][0] as any
    expect(call.where).toEqual({ id: 'post-1' })
    expect(call.data.status).toBe('PUBLISHED')
    expect(call.data.publishedAt).toBeInstanceOf(Date)
    // An existing author is not overwritten by the editing admin.
    expect(call.data.authorId).toBeUndefined()
  })

  it('400 for an empty body and 409 for a taken slug', async () => {
    expect((await patchPost(req({}), ctx('post-1'))).status).toBe(400)
    vi.mocked(prisma.blogPost.findUnique).mockResolvedValue({
      id: 'post-1',
      slug: 'old',
      locale: 'sk',
      status: 'DRAFT',
      publishedAt: null,
      authorId: null,
    } as any)
    vi.mocked(prisma.blogPost.update).mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    )
    expect((await patchPost(req({ slug: 'taken' }), ctx('post-1'))).status).toBe(409)
  })

  it('DELETE removes the post and revalidates its path', async () => {
    vi.mocked(prisma.blogPost.findUnique).mockResolvedValue({
      id: 'post-1',
      slug: 'old',
      locale: 'en',
      title: 'Old',
      status: 'PUBLISHED',
    } as any)
    const res = await deletePost(req(null), ctx('post-1'))
    expect(res.status).toBe(200)
    expect(prisma.blogPost.delete).toHaveBeenCalledWith({ where: { id: 'post-1' } })
    expect(revalidatePath).toHaveBeenCalledWith('/en/blog/old')
  })
})

describe('categories', () => {
  it('400 when no name is given and for an unknown locale key', async () => {
    expect((await createCategory(req({ slug: 'kariera', names: { sk: '  ' } }))).status).toBe(400)
    expect((await createCategory(req({ slug: 'kariera', names: { fr: 'Carrière' } }))).status).toBe(
      400,
    )
  })

  it('creates with the next sortOrder', async () => {
    vi.mocked(prisma.blogCategory.findFirst).mockResolvedValue({ sortOrder: 4 } as any)
    vi.mocked(prisma.blogCategory.create).mockResolvedValue({ id: 'cat-9', slug: 'kariera' } as any)
    const res = await createCategory(req({ slug: 'kariera', names: { sk: 'Kariéra', en: '' } }))
    expect(res.status).toBe(201)
    expect(prisma.blogCategory.create).toHaveBeenCalledWith({
      data: { slug: 'kariera', names: { sk: 'Kariéra' }, sortOrder: 5 },
    })
  })

  it('409 for a duplicate category slug', async () => {
    vi.mocked(prisma.blogCategory.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.blogCategory.create).mockRejectedValue(
      Object.assign(new Error('Unique'), { code: 'P2002' }),
    )
    expect((await createCategory(req({ slug: 'kariera', names: { sk: 'K' } }))).status).toBe(409)
  })

  it('PATCH renames a category', async () => {
    vi.mocked(prisma.blogCategory.findUnique).mockResolvedValue({
      id: 'cat-1',
      slug: 'kariera',
      names: { sk: 'Kariéra' },
      sortOrder: 0,
    } as any)
    vi.mocked(prisma.blogCategory.update).mockResolvedValue({
      id: 'cat-1',
      slug: 'kariera',
      names: { sk: 'Kariéra', en: 'Career' },
      sortOrder: 0,
    } as any)
    const res = await patchCategory(req({ names: { sk: 'Kariéra', en: 'Career' } }), ctx('cat-1'))
    expect(res.status).toBe(200)
    expect(prisma.blogCategory.update).toHaveBeenCalledWith({
      where: { id: 'cat-1' },
      data: { names: { sk: 'Kariéra', en: 'Career' } },
    })
  })

  it('reorder rejects unknown ids and writes sortOrder = index', async () => {
    vi.mocked(prisma.blogCategory.findMany).mockResolvedValue([{ id: 'a' }] as any)
    expect((await reorderCategories(req({ order: ['a', 'b'] }))).status).toBe(400)

    vi.mocked(prisma.blogCategory.findMany).mockResolvedValue([{ id: 'a' }, { id: 'b' }] as any)
    vi.mocked(prisma.$transaction).mockResolvedValue([] as any)
    expect((await reorderCategories(req({ order: ['b', 'a'] }))).status).toBe(200)
    expect(prisma.blogCategory.update).toHaveBeenCalledWith({
      where: { id: 'b' },
      data: { sortOrder: 0 },
    })
    expect(prisma.blogCategory.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { sortOrder: 1 },
    })
  })
})
