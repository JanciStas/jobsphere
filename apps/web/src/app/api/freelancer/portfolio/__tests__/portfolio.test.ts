import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: unknown) => h }))
vi.mock('@/lib/csrf', () => ({ withCsrfProtection: (h: unknown) => h }))
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    freelancerProfile: { findUnique: vi.fn() },
    portfolioItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

import { GET, POST } from '../route'
import { PATCH, DELETE } from '../[itemId]/route'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>
const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/freelancer/portfolio', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

beforeEach(() => {
  vi.clearAllMocks()
  m(auth).mockResolvedValue({ user: { id: 'u1' } })
  m(prisma.freelancerProfile.findUnique).mockResolvedValue({ id: 'f1' })
})

describe('GET /api/freelancer/portfolio', () => {
  it('401 without a session', async () => {
    m(auth).mockResolvedValue(null)
    expect((await GET(req('GET') as never)).status).toBe(401)
  })
  it('returns [] when the table is missing', async () => {
    m(prisma.portfolioItem.findMany).mockRejectedValue({ code: 'P2021' })
    const res = await GET(req('GET') as never)
    expect(res.status).toBe(200)
    expect((await res.json()).items).toEqual([])
  })
})

describe('POST /api/freelancer/portfolio', () => {
  it('rejects bad urls, empty title and too many tags', async () => {
    expect((await POST(req('POST', { title: 'x', url: 'javascript:alert(1)' }))).status).toBe(400)
    expect((await POST(req('POST', { title: 'x', imageUrl: 'http://a.com/i.png' }))).status).toBe(
      400,
    )
    expect((await POST(req('POST', { title: '' }))).status).toBe(400)
    expect((await POST(req('POST', { title: 'x', tags: Array(11).fill('a') }))).status).toBe(400)
  })
  it('403 without a freelancer profile', async () => {
    m(prisma.freelancerProfile.findUnique).mockResolvedValue(null)
    expect((await POST(req('POST', { title: 'x' }))).status).toBe(403)
  })
  it('409 at the 24-item limit', async () => {
    m(prisma.portfolioItem.count).mockResolvedValue(24)
    expect((await POST(req('POST', { title: 'x' }))).status).toBe(409)
    expect(prisma.portfolioItem.create).not.toHaveBeenCalled()
  })
  it('503 when the table is missing', async () => {
    m(prisma.portfolioItem.count).mockRejectedValue({ code: 'P2021' })
    expect((await POST(req('POST', { title: 'x' }))).status).toBe(503)
  })
  it('creates an item scoped to the own profile', async () => {
    m(prisma.portfolioItem.count).mockResolvedValue(0)
    m(prisma.portfolioItem.create).mockResolvedValue({ id: 'i1', title: 'x' })
    const res = await POST(
      req('POST', { title: 'x', url: 'https://a.com', imageUrl: 'https://a.com/i.png' }),
    )
    expect(res.status).toBe(201)
    expect(m(prisma.portfolioItem.create).mock.calls[0][0].data.freelancerId).toBe('f1')
  })
})

describe('PATCH/DELETE /api/freelancer/portfolio/[itemId] (IDOR)', () => {
  const ctx = { params: { itemId: 'foreign' } }
  it('PATCH on a foreign item is 404 and mutates nothing', async () => {
    m(prisma.portfolioItem.findFirst).mockResolvedValue(null)
    const res = await PATCH(req('PATCH', { title: 'hack' }), ctx)
    expect(res.status).toBe(404)
    expect(prisma.portfolioItem.update).not.toHaveBeenCalled()
    expect(m(prisma.portfolioItem.findFirst).mock.calls[0][0].where).toEqual({
      id: 'foreign',
      freelancer: { userId: 'u1' },
    })
  })
  it('DELETE on a foreign item is 404 and deletes nothing', async () => {
    m(prisma.portfolioItem.findFirst).mockResolvedValue(null)
    const res = await DELETE(req('DELETE'), ctx)
    expect(res.status).toBe(404)
    expect(prisma.portfolioItem.delete).not.toHaveBeenCalled()
  })
  it('PATCH own item succeeds', async () => {
    m(prisma.portfolioItem.findFirst).mockResolvedValue({ id: 'i1' })
    m(prisma.portfolioItem.update).mockResolvedValue({ id: 'i1', title: 'new' })
    const res = await PATCH(req('PATCH', { title: 'new' }), { params: { itemId: 'i1' } })
    expect(res.status).toBe(200)
  })
})
