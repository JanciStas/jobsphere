import { describe, it, expect, afterEach, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ prisma: {} }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
const create = vi.fn().mockResolvedValue({ data: [{ embedding: [0.1, 0.2] }] })
vi.mock('openai', () => ({
  default: class {
    embeddings = { create }
  },
}))

import { generateEmbedding, stubEmbedding } from '../embeddings'

afterEach(() => {
  delete process.env.E2E_STUB_EMBEDDINGS
  delete process.env.VERCEL
  create.mockClear()
})

describe('stubEmbedding', () => {
  it('is deterministic, unit length and text-dependent', () => {
    const a = stubEmbedding('senior react developer', 8)
    const b = stubEmbedding('senior react developer', 8)
    const c = stubEmbedding('python backend', 8)

    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect(Math.sqrt(a.reduce((s, v) => s + v * v, 0))).toBeCloseTo(1, 6)
  })
})

describe('generateEmbedding E2E stub guard', () => {
  it('calls OpenAI by default', async () => {
    const result = await generateEmbedding('hello')

    expect(create).toHaveBeenCalledTimes(1)
    expect(result).toEqual([0.1, 0.2])
  })

  it('returns the stub only when E2E_STUB_EMBEDDINGS=1', async () => {
    process.env.E2E_STUB_EMBEDDINGS = '1'

    const result = await generateEmbedding('hello')

    expect(create).not.toHaveBeenCalled()
    expect(result).toHaveLength(1536)
  })

  it('never stubs on Vercel, even if the variable leaks into the environment', async () => {
    process.env.E2E_STUB_EMBEDDINGS = '1'
    process.env.VERCEL = '1'

    await generateEmbedding('hello')

    expect(create).toHaveBeenCalledTimes(1)
  })
})
