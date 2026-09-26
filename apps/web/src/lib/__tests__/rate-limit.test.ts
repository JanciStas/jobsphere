import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  rateLimit,
  rateLimitByIp,
  rateLimitByUser,
  rateLimitByApiKey,
  strictRateLimit,
  getClientIp,
  RateLimitPresets,
  withRateLimit,
  rateLimitMiddleware,
} from '../rate-limit'

// Create mock pipeline that we can access in tests
const mockPipeline = {
  zremrangebyscore: vi.fn().mockReturnThis(),
  zcard: vi.fn().mockReturnThis(),
  zadd: vi.fn().mockReturnThis(),
  expire: vi.fn().mockReturnThis(),
  exec: vi.fn(),
}

const { getTokenMock } = vi.hoisted(() => ({ getTokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

// Mock Redis
vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(() => ({
    pipeline: vi.fn(() => mockPipeline),
  })),
}))

describe('Rate Limit Library', () => {
  const originalEnv = {
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    NODE_ENV: process.env.NODE_ENV,
    DISABLE_RATE_LIMIT: process.env.DISABLE_RATE_LIMIT,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.KV_REST_API_URL = 'https://test-redis.upstash.io'
    process.env.KV_REST_API_TOKEN = 'test-token'
    // Enable rate limiting for tests (override test environment)
    process.env.NODE_ENV = 'development'
    delete process.env.DISABLE_RATE_LIMIT
    // Reset mock implementations
    mockPipeline.zremrangebyscore.mockReturnThis()
    mockPipeline.zcard.mockReturnThis()
    mockPipeline.zadd.mockReturnThis()
    mockPipeline.expire.mockReturnThis()
  })

  afterEach(() => {
    process.env.KV_REST_API_URL = originalEnv.KV_REST_API_URL
    process.env.KV_REST_API_TOKEN = originalEnv.KV_REST_API_TOKEN
    process.env.NODE_ENV = originalEnv.NODE_ENV
    if (originalEnv.DISABLE_RATE_LIMIT) {
      process.env.DISABLE_RATE_LIMIT = originalEnv.DISABLE_RATE_LIMIT
    } else {
      delete process.env.DISABLE_RATE_LIMIT
    }
  })

  describe('rateLimit', () => {
    it('should allow request when under limit', async () => {
      // Mock 3 existing requests
      mockPipeline.exec.mockResolvedValue([null, 3, null, null])

      const result = await rateLimit({
        identifier: '127.0.0.1',
        limit: 10,
        window: 60,
      })

      expect(result.success).toBe(true)
      expect(result.limit).toBe(10)
      expect(result.remaining).toBe(6) // 10 - 3 - 1 = 6
      expect(result.reset).toBeGreaterThan(Date.now())
    })

    // SEC-011: DISABLE_RATE_LIMIT must only take effect outside production.
    it('honors DISABLE_RATE_LIMIT outside production (short-circuits, no Redis call)', async () => {
      process.env.NODE_ENV = 'development'
      process.env.DISABLE_RATE_LIMIT = 'true'

      const result = await rateLimit({ identifier: '127.0.0.1', limit: 10, window: 60 })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(10) // full remaining = short-circuited
      expect(mockPipeline.zadd).not.toHaveBeenCalled()
    })

    it('IGNORES DISABLE_RATE_LIMIT in production (limiter stays active)', async () => {
      process.env.NODE_ENV = 'production'
      process.env.DISABLE_RATE_LIMIT = 'true'
      mockPipeline.exec.mockResolvedValue([null, 3, null, null])

      const result = await rateLimit({ identifier: '127.0.0.1', limit: 10, window: 60 })

      // Not short-circuited: it consulted Redis and consumed a slot.
      expect(mockPipeline.zadd).toHaveBeenCalled()
      expect(result.remaining).toBe(6) // 10 - 3 - 1
    })

    it('should deny request when at limit', async () => {
      // Mock 10 existing requests (at limit)
      mockPipeline.exec.mockResolvedValue([null, 10, null, null])

      const result = await rateLimit({
        identifier: '127.0.0.1',
        limit: 10,
        window: 60,
      })

      expect(result.success).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should deny request when over limit', async () => {
      // Mock 15 existing requests (over limit)
      mockPipeline.exec.mockResolvedValue([null, 15, null, null])

      const result = await rateLimit({
        identifier: '127.0.0.1',
        limit: 10,
        window: 60,
      })

      expect(result.success).toBe(false)
      expect(result.remaining).toBe(0)
    })

    it('should use custom prefix', async () => {
      mockPipeline.exec.mockResolvedValue([null, 0, null, null])

      await rateLimit({
        identifier: 'user-123',
        limit: 100,
        window: 60,
        prefix: 'custom-prefix',
      })

      // Verify Redis operations were called
      expect(mockPipeline.zremrangebyscore).toHaveBeenCalled()
      expect(mockPipeline.zcard).toHaveBeenCalled()
      expect(mockPipeline.zadd).toHaveBeenCalled()
      expect(mockPipeline.expire).toHaveBeenCalled()
    })

    it('should handle different window sizes', async () => {
      mockPipeline.exec.mockResolvedValue([null, 0, null, null])

      const result300 = await rateLimit({
        identifier: 'test',
        limit: 10,
        window: 300, // 5 minutes
      })

      expect(result300.reset).toBeGreaterThan(Date.now() + 299000)
    })

    it('should fail-closed with in-memory fallback on Redis error', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('Redis connection failed'))

      const result = await rateLimit({
        identifier: '127.0.0.1',
        limit: 10,
        window: 60,
      })

      // Should use in-memory fallback with conservative limit (50% of requested)
      expect(result.success).toBe(true)
      expect(result.limit).toBe(10) // Original limit is preserved in response
      // In-memory tracks requests, first request should succeed
    })

    it('should use conservative limit in memory fallback', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('Redis down'))

      // Make multiple requests to test conservative limit
      const identifier = 'test-conservative-' + Date.now()
      const results = []

      for (let i = 0; i < 7; i++) {
        const result = await rateLimit({
          identifier,
          limit: 10, // Requested limit
          window: 60,
        })
        results.push(result)
      }

      // First 5 should succeed (50% of 10 = 5), 6th and 7th should fail
      expect(results[0].success).toBe(true)
      expect(results[4].success).toBe(true)
      expect(results[5].success).toBe(false)
      expect(results[6].success).toBe(false)
    })

    it('should handle zero count correctly', async () => {
      mockPipeline.exec.mockResolvedValue([null, 0, null, null])

      const result = await rateLimit({
        identifier: 'new-user',
        limit: 5,
        window: 60,
      })

      expect(result.success).toBe(true)
      expect(result.remaining).toBe(4) // 5 - 0 - 1 = 4
    })
  })

  describe('rateLimitByIp', () => {
    it('should rate limit by IP with default values', async () => {
      mockPipeline.exec.mockResolvedValue([null, 50, null, null])

      const result = await rateLimitByIp('192.168.1.1')

      expect(result.success).toBe(true)
      expect(result.limit).toBe(100) // Default limit
    })

    it('should rate limit by IP with custom limit', async () => {
      mockPipeline.exec.mockResolvedValue([null, 15, null, null])

      const result = await rateLimitByIp('192.168.1.1', 20, 120)

      expect(result.success).toBe(true)
      expect(result.limit).toBe(20)
    })

    it('should handle IPv6 addresses', async () => {
      mockPipeline.exec.mockResolvedValue([null, 5, null, null])

      const result = await rateLimitByIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')

      expect(result.success).toBe(true)
    })
  })

  describe('rateLimitByUser', () => {
    it('should rate limit by user ID with default values', async () => {
      mockPipeline.exec.mockResolvedValue([null, 250, null, null])

      const result = await rateLimitByUser('user-123')

      expect(result.success).toBe(true)
      expect(result.limit).toBe(500) // Default limit
    })

    it('should rate limit by user with custom limit', async () => {
      mockPipeline.exec.mockResolvedValue([null, 90, null, null])

      const result = await rateLimitByUser('user-456', 100, 60)

      expect(result.success).toBe(true)
      expect(result.limit).toBe(100)
    })
  })

  describe('rateLimitByApiKey', () => {
    it('should rate limit by API key with default values', async () => {
      mockPipeline.exec.mockResolvedValue([null, 500, null, null])

      const result = await rateLimitByApiKey('sk_test_123')

      expect(result.success).toBe(true)
      expect(result.limit).toBe(1000) // Default limit
    })

    it('should rate limit by API key with custom limit', async () => {
      mockPipeline.exec.mockResolvedValue([null, 1500, null, null])

      const result = await rateLimitByApiKey('sk_prod_456', 2000, 60)

      expect(result.success).toBe(true)
      expect(result.limit).toBe(2000)
    })
  })

  describe('strictRateLimit', () => {
    it('should use strict limits by default', async () => {
      mockPipeline.exec.mockResolvedValue([null, 3, null, null])

      const result = await strictRateLimit('login-attempt-user123')

      expect(result.success).toBe(true)
      expect(result.limit).toBe(5) // Default strict limit
    })

    it('should have longer window for strict limits', async () => {
      mockPipeline.exec.mockResolvedValue([null, 0, null, null])

      const result = await strictRateLimit('signup-192.168.1.1')

      // Window is 900 seconds (15 minutes)
      expect(result.reset).toBeGreaterThan(Date.now() + 899000)
    })

    it('should deny after strict limit reached', async () => {
      mockPipeline.exec.mockResolvedValue([null, 5, null, null])

      const result = await strictRateLimit('failed-login-user', 5, 900)

      expect(result.success).toBe(false)
    })
  })

  describe('getClientIp', () => {
    it('prefers x-vercel-forwarded-for, which a client cannot spoof on Vercel', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-vercel-forwarded-for': '203.0.113.9',
          'x-forwarded-for': '6.6.6.6',
        },
      })

      expect(getClientIp(request)).toBe('203.0.113.9')
    })

    it('should extract IP from x-forwarded-for header', () => {
      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.1' },
      })

      const ip = getClientIp(request)

      expect(ip).toBe('203.0.113.1')
    })

    it('should extract IP from x-real-ip header', () => {
      const request = new Request('http://localhost', {
        headers: { 'x-real-ip': '198.51.100.5' },
      })

      const ip = getClientIp(request)

      expect(ip).toBe('198.51.100.5')
    })

    it('should prefer x-forwarded-for over x-real-ip', () => {
      const request = new Request('http://localhost', {
        headers: {
          'x-forwarded-for': '203.0.113.1',
          'x-real-ip': '198.51.100.5',
        },
      })

      const ip = getClientIp(request)

      expect(ip).toBe('203.0.113.1')
    })

    it('should return "unknown" when no IP headers present', () => {
      const request = new Request('http://localhost')

      const ip = getClientIp(request)

      expect(ip).toBe('unknown')
    })

    it('should trim whitespace from IP', () => {
      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '  203.0.113.1  , 198.51.100.1' },
      })

      const ip = getClientIp(request)

      expect(ip).toBe('203.0.113.1')
    })
  })

  describe('RateLimitPresets', () => {
    it('should have auth preset with strict limits', () => {
      expect(RateLimitPresets.auth).toEqual({ limit: 5, window: 60 })
    })

    it('should have api preset with moderate limits', () => {
      expect(RateLimitPresets.api).toEqual({ limit: 100, window: 60 })
    })

    it('should have public preset with higher limits', () => {
      expect(RateLimitPresets.public).toEqual({ limit: 200, window: 60 })
    })

    it('should have strict preset with very low limits', () => {
      expect(RateLimitPresets.strict).toEqual({ limit: 10, window: 900 })
    })

    it('should have upload preset with bounded limits', () => {
      expect(RateLimitPresets.upload).toEqual({ limit: 30, window: 300 })
    })
  })

  describe('withRateLimit byUser', () => {
    const run = async (headers: Record<string, string>) => {
      mockPipeline.exec.mockResolvedValue([null, 1, null, null])
      const wrapped = withRateLimit(vi.fn().mockResolvedValue(new Response('OK')), {
        preset: 'api',
        byUser: true,
      })
      await wrapped(new Request('http://localhost', { headers }))
      return mockPipeline.zremrangebyscore.mock.calls[0][0] as string
    }

    it('keys on the user id from the signed session cookie', async () => {
      getTokenMock.mockResolvedValue({ id: 'user-42' })

      expect(await run({ 'x-forwarded-for': '203.0.113.1' })).toBe('ratelimit:user:user:user-42')
    })

    it('ignores an attacker-supplied Authorization: Bearer value', async () => {
      getTokenMock.mockResolvedValue(null)

      const key = await run({
        authorization: 'Bearer rotate-me-1',
        'x-forwarded-for': '203.0.113.1',
      })

      expect(key).toBe('ratelimit:user:203.0.113.1')
      expect(key).not.toContain('rotate-me')
    })

    it('falls back to the IP when the JWT cannot be decoded', async () => {
      getTokenMock.mockRejectedValue(new Error('bad token'))

      expect(await run({ 'x-forwarded-for': '203.0.113.7' })).toBe('ratelimit:user:203.0.113.7')
    })
  })

  describe('withRateLimit', () => {
    it('should call handler when rate limit not exceeded', async () => {
      mockPipeline.exec.mockResolvedValue([null, 50, null, null])

      const mockHandler = vi.fn().mockResolvedValue(new Response('OK', { status: 200 }))
      const wrapped = withRateLimit(mockHandler, { preset: 'api' })

      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.1' },
      })

      const response = await wrapped(request)

      expect(mockHandler).toHaveBeenCalledWith(request, undefined)
      expect(response.status).toBe(200)
    })

    it('should add rate limit headers to response', async () => {
      mockPipeline.exec.mockResolvedValue([null, 50, null, null])

      const mockHandler = vi.fn().mockResolvedValue(new Response('OK'))
      const wrapped = withRateLimit(mockHandler, { preset: 'api' })

      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.1' },
      })

      const response = await wrapped(request)

      expect(response.headers.get('X-RateLimit-Limit')).toBeTruthy()
      expect(response.headers.get('X-RateLimit-Remaining')).toBeTruthy()
      expect(response.headers.get('X-RateLimit-Reset')).toBeTruthy()
    })

    it('should use custom limit and window', async () => {
      mockPipeline.exec.mockResolvedValue([null, 5, null, null])

      const mockHandler = vi.fn().mockResolvedValue(new Response('OK'))
      const wrapped = withRateLimit(mockHandler, { limit: 10, window: 120 })

      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.1' },
      })

      await wrapped(request)

      expect(mockHandler).toHaveBeenCalled()
    })
  })

  describe('rateLimitMiddleware', () => {
    it('should return result when limit not exceeded', async () => {
      mockPipeline.exec.mockResolvedValue([null, 30, null, null])

      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.1' },
      })

      const result = await rateLimitMiddleware(request, { preset: 'api' })

      expect(result).toHaveProperty('success', true)
      expect(result).toHaveProperty('limit', 100)
      expect(result).toHaveProperty('remaining')
    })

    it('should return 429 Response when limit exceeded', async () => {
      mockPipeline.exec.mockResolvedValue([null, 100, null, null])

      const request = new Request('http://localhost', {
        headers: { 'x-forwarded-for': '203.0.113.1' },
      })

      const result = await rateLimitMiddleware(request, { preset: 'api' })

      expect(result).toBeInstanceOf(Response)
      if (result instanceof Response) {
        expect(result.status).toBe(429)
        expect(await result.text()).toBe('Too Many Requests')
        expect(result.headers.get('X-RateLimit-Limit')).toBeTruthy()
        expect(result.headers.get('Retry-After')).toBeTruthy()
      }
    })

    it('should use user-based rate limiting when byUser is true', async () => {
      mockPipeline.exec.mockResolvedValue([null, 10, null, null])

      const request = new Request('http://localhost', {
        headers: { 'x-user-id': 'user-123' },
      })

      const result = await rateLimitMiddleware(request, {
        byUser: true,
        limit: 50,
        window: 60,
      })

      expect(result).toHaveProperty('success', true)
    })
  })

  describe('Edge cases', () => {
    it('should handle concurrent requests', async () => {
      mockPipeline.exec.mockResolvedValue([null, 5, null, null])

      const promises = Array.from({ length: 10 }, (_, i) =>
        rateLimit({
          identifier: `user-${i}`,
          limit: 10,
          window: 60,
        }),
      )

      const results = await Promise.all(promises)

      expect(results).toHaveLength(10)
      results.forEach((result) => {
        expect(result).toHaveProperty('success')
        expect(result).toHaveProperty('limit')
        expect(result).toHaveProperty('remaining')
      })
    })

    it('should handle very high limits', async () => {
      mockPipeline.exec.mockResolvedValue([null, 50000, null, null])

      const result = await rateLimit({
        identifier: 'enterprise-client',
        limit: 100000,
        window: 60,
      })

      expect(result.success).toBe(true)
      expect(result.remaining).toBeGreaterThan(0)
    })

    it('should handle very short windows', async () => {
      mockPipeline.exec.mockResolvedValue([null, 3, null, null])

      const result = await rateLimit({
        identifier: 'test',
        limit: 10,
        window: 1, // 1 second window
      })

      expect(result.success).toBe(true)
    })
  })
})
