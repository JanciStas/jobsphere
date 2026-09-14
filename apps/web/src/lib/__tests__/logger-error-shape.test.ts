/**
 * logger.error accepts two call shapes and must not lose the error in either.
 *
 * 101 call sites pass `logger.error(msg, { error, ...ctx })`. Before this the
 * second argument went through String(), so production logs read
 * `"error": "[object Object]"` and a month of failing embedding jobs had no
 * diagnosable cause in the logs at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { logger } from '../logger'

let spy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  spy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  spy.mockRestore()
})

const lastLog = () => String(spy.mock.calls.at(-1)?.[0] ?? '')

describe('logger.error', () => {
  it('unpacks the { error, ...context } shape', () => {
    logger.error('Failed to generate embedding', {
      error: new Error('model not found'),
      resumeId: 'r-1',
    })
    const out = lastLog()
    expect(out).toContain('model not found')
    expect(out).toContain('"resumeId": "r-1"')
    expect(out).not.toContain('[object Object]')
  })

  it('still handles the (msg, Error, ctx) shape', () => {
    logger.error('boom', new Error('kaboom'), { jobId: 'j-1' })
    const out = lastLog()
    expect(out).toContain('kaboom')
    expect(out).toContain('"jobId": "j-1"')
  })

  it('describes non-Error throwables instead of stringifying to [object Object]', () => {
    // Prisma and Zod throw objects that are not `instanceof Error` across
    // module boundaries; they still carry message/code.
    logger.error('db failed', {
      error: { name: 'PrismaClientKnownRequestError', message: 'P2002 unique', code: 'P2002' },
    })
    const out = lastLog()
    expect(out).toContain('P2002 unique')
    expect(out).toContain('"code": "P2002"')
    expect(out).not.toContain('[object Object]')
  })

  it('does not leak secrets carried inside the unpacked context', () => {
    logger.error('oauth failed', { error: new Error('x'), accessToken: 'ya29.secret' })
    expect(lastLog()).not.toContain('ya29.secret')
  })
})
