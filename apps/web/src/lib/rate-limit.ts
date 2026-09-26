/**
 * Rate Limiting using Vercel KV (Redis) with In-Memory Fallback
 * Sliding window rate limiter with fail-closed behavior
 */

import { Redis } from '@upstash/redis'
import { getToken } from 'next-auth/jwt'
import { logger } from './logger'

let redis: Redis | null = null
let redisUrl: string | undefined = undefined
let redisToken: string | undefined = undefined

if (
  process.env.NODE_ENV === 'production' &&
  (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN)
) {
  logger.error(
    'Upstash KV not configured — rate limit falls back to in-memory which resets on cold start. Configure KV_REST_API_URL + KV_REST_API_TOKEN for production safety.',
  )
}

if (process.env.NODE_ENV === 'production' && process.env.DISABLE_RATE_LIMIT === 'true') {
  logger.error(
    'DISABLE_RATE_LIMIT=true is set in production and is being IGNORED — rate limiting stays active (SEC-011). Remove this env var; it only takes effect in development/test.',
  )
}

function getRedis(): Redis | null {
  const currentUrl = process.env.KV_REST_API_URL
  const currentToken = process.env.KV_REST_API_TOKEN

  // Reset singleton if env vars changed (supports test environments)
  if (redis && (currentUrl !== redisUrl || currentToken !== redisToken)) {
    redis = null
  }

  if (redis) return redis
  if (!currentUrl || !currentToken) return null

  redisUrl = currentUrl
  redisToken = currentToken
  redis = new Redis({
    url: currentUrl,
    token: currentToken,
  })
  return redis
}

/**
 * In-memory rate limiter fallback (when Redis fails)
 * Uses Map with sliding window algorithm
 */
interface InMemoryEntry {
  timestamps: number[]
  lastCleanup: number
}

const inMemoryStore = new Map<string, InMemoryEntry>()

// Circuit breaker state
let redisFailureCount = 0
let lastRedisFailure = 0
const CIRCUIT_BREAKER_THRESHOLD = 5
const CIRCUIT_BREAKER_TIMEOUT = 60000 // 1 minute

/**
 * Reset internal state — for use in tests only.
 * Clears circuit breaker counters, in-memory store, and Redis singleton.
 */
export function __resetRateLimitState() {
  redisFailureCount = 0
  lastRedisFailure = 0
  inMemoryStore.clear()
  redis = null
  redisUrl = undefined
  redisToken = undefined
}

function isCircuitOpen(): boolean {
  const now = Date.now()
  if (redisFailureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    if (now - lastRedisFailure < CIRCUIT_BREAKER_TIMEOUT) {
      return true
    }
    // Reset circuit breaker after timeout
    redisFailureCount = 0
  }
  return false
}

function recordRedisFailure() {
  redisFailureCount++
  lastRedisFailure = Date.now()
  if (redisFailureCount === CIRCUIT_BREAKER_THRESHOLD) {
    logger.warn('Rate Limit Circuit breaker OPEN', {
      redisFailureCount,
      threshold: CIRCUIT_BREAKER_THRESHOLD,
    })
  }
}

function recordRedisSuccess() {
  if (redisFailureCount > 0) {
    redisFailureCount = 0
  }
}

/**
 * In-memory rate limiter with sliding window
 * More conservative limits than Redis version (fail-closed)
 */
function rateLimitInMemory(
  identifier: string,
  limit: number,
  window: number,
  reportedLimit?: number,
): RateLimitResult {
  const now = Date.now()
  const windowStart = now - window * 1000

  // Get or create entry
  let entry = inMemoryStore.get(identifier)
  if (!entry) {
    entry = { timestamps: [], lastCleanup: now }
    inMemoryStore.set(identifier, entry)
  }

  // Clean old entries every 60 seconds to prevent memory leak
  if (now - entry.lastCleanup > 60000) {
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart)
    entry.lastCleanup = now
  } else {
    // Remove timestamps outside window
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart)
  }

  // Check if limit exceeded
  const count = entry.timestamps.length
  const success = count < limit

  if (success) {
    entry.timestamps.push(now)
  }

  const remaining = Math.max(0, limit - count - 1)
  const reset = now + window * 1000

  return {
    success,
    limit: reportedLimit ?? limit,
    remaining,
    reset,
  }
}

// Cleanup in-memory store every 5 minutes (only in runtime, not during build)
if (typeof window === 'undefined' && process.env.NEXT_PHASE !== 'phase-production-build') {
  setInterval(() => {
    const now = Date.now()
    const maxAge = 900000 // 15 minutes

    for (const [key, entry] of inMemoryStore.entries()) {
      if (now - entry.lastCleanup > maxAge) {
        inMemoryStore.delete(key)
      }
    }

    logger.info('Rate Limit in-memory store cleanup', {
      storeSize: inMemoryStore.size,
      maxAge,
    })
  }, 300000)
}

export interface RateLimitConfig {
  /**
   * Unique identifier (IP, userId, etc.)
   */
  identifier: string

  /**
   * Maximum requests allowed
   */
  limit: number

  /**
   * Window duration in seconds
   */
  window: number

  /**
   * Optional prefix for Redis key
   */
  prefix?: string
}

export interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: number
}

/**
 * Check rate limit using sliding window
 * Falls back to in-memory limiter on Redis failure (fail-closed)
 */
export async function rateLimit(config: RateLimitConfig): Promise<RateLimitResult> {
  const { identifier, limit, window, prefix = 'ratelimit' } = config

  const key = `${prefix}:${identifier}`
  const now = Date.now()
  const windowStart = now - window * 1000

  // Skip rate limiting when explicitly disabled — but NEVER in production, so a
  // stray DISABLE_RATE_LIMIT=true on a live deployment can't silently strip all
  // rate limiting (SEC-011). Honored only in development/test.
  if (process.env.DISABLE_RATE_LIMIT === 'true' && process.env.NODE_ENV !== 'production') {
    return {
      success: true,
      limit,
      remaining: limit,
      reset: now + window * 1000,
    }
  }

  const circuitOpen = isCircuitOpen()

  // If Upstash is not configured OR circuit breaker is open, go straight to in-memory
  const redisClient = getRedis()
  if (!redisClient || circuitOpen) {
    // Use conservative limit (50%) when circuit is open or Redis unavailable
    const conservativeLimit = !redisClient ? limit : Math.ceil(limit / 2)
    return rateLimitInMemory(identifier, conservativeLimit, window, limit)
  }

  try {
    // Use Redis pipeline for atomic operations
    const pipeline = redisClient.pipeline()

    // Remove old entries outside window
    pipeline.zremrangebyscore(key, 0, windowStart)

    // Count requests in current window
    pipeline.zcard(key)

    // Add current request
    pipeline.zadd(key, { score: now, member: `${now}:${Math.random()}` })

    // Set expiry on key
    pipeline.expire(key, window)

    const results = await pipeline.exec()

    // Get count (index 1 in results)
    const count = (results[1] as number) || 0

    const success = count < limit
    const remaining = Math.max(0, limit - count - 1)
    const reset = now + window * 1000

    // Record successful Redis operation
    recordRedisSuccess()

    return {
      success,
      limit,
      remaining,
      reset,
    }
  } catch (error) {
    const conservativeLimit = Math.ceil(limit / 2)

    logger.error('Rate Limit Redis error - falling back to in-memory limiter', {
      error,
      identifier,
      requestedLimit: limit,
      conservativeLimit,
    })

    // Record Redis failure for circuit breaker
    recordRedisFailure()

    // SECURITY: Fail-closed with in-memory fallback (more conservative limit)
    // Use 50% of requested limit to be extra cautious
    return rateLimitInMemory(identifier, conservativeLimit, window, limit)
  }
}

/**
 * Rate limit by IP address
 */
export async function rateLimitByIp(
  ip: string,
  limit = 100,
  window = 60,
): Promise<RateLimitResult> {
  return rateLimit({
    identifier: ip,
    limit,
    window,
    prefix: 'ratelimit:ip',
  })
}

/**
 * Rate limit by user ID
 */
export async function rateLimitByUser(
  userId: string,
  limit = 500,
  window = 60,
): Promise<RateLimitResult> {
  return rateLimit({
    identifier: userId,
    limit,
    window,
    prefix: 'ratelimit:user',
  })
}

/**
 * Rate limit by API key
 */
export async function rateLimitByApiKey(
  apiKey: string,
  limit = 1000,
  window = 60,
): Promise<RateLimitResult> {
  return rateLimit({
    identifier: apiKey,
    limit,
    window,
    prefix: 'ratelimit:apikey',
  })
}

/**
 * Strict rate limit for sensitive endpoints (login, signup)
 */
export async function strictRateLimit(
  identifier: string,
  limit = 5,
  window = 900, // 15 minutes
): Promise<RateLimitResult> {
  return rateLimit({
    identifier,
    limit,
    window,
    prefix: 'ratelimit:strict',
  })
}

/**
 * Get client IP from request
 */
export function getClientIp(request: Request): string {
  // x-vercel-forwarded-for is set by Vercel's edge and cannot be supplied by the
  // client, unlike a raw x-forwarded-for on a deployment without a trusted proxy.
  const vercelForwarded = request.headers.get('x-vercel-forwarded-for')
  if (vercelForwarded) {
    return vercelForwarded.split(',')[0].trim()
  }

  // Vercel also overwrites x-forwarded-for; elsewhere it is only as trustworthy
  // as the proxy in front of the app.
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }

  // Fallback to x-real-ip
  const realIp = request.headers.get('x-real-ip')
  if (realIp) {
    return realIp
  }

  // Last resort
  return 'unknown'
}

/**
 * User id from the signed NextAuth JWT cookie, or null when the request is not
 * authenticated. Pure JWT decode — no DB access, no session callbacks.
 */
export async function resolveUserIdentifier(request: Request): Promise<string | null> {
  try {
    const token = await getToken({
      req: request as never,
      secret: process.env.NEXTAUTH_SECRET,
    })
    const id = token?.id ?? token?.sub
    return typeof id === 'string' && id ? `user:${id}` : null
  } catch {
    return null
  }
}

/**
 * Rate limit presets
 */
export const RateLimitPresets = {
  auth: { limit: 5, window: 60 }, // 5 requests per minute
  api: { limit: 100, window: 60 }, // 100 requests per minute
  public: { limit: 200, window: 60 }, // 200 requests per minute
  strict: { limit: 10, window: 900 }, // 10 requests per 15 minutes
  upload: { limit: 30, window: 300 }, // 30 uploads per 5 minutes (CV upload + AI parse share this; 10 was too low for real retries/demos)
} as const

type RateLimitPreset = keyof typeof RateLimitPresets

/**
 * Higher-order function to wrap API routes with rate limiting
 */
export function withRateLimit<T extends Request = Request>(
  handler: (request: T, context?: { params?: Record<string, string> }) => Promise<Response>,
  options: {
    preset?: RateLimitPreset
    limit?: number
    window?: number
    byUser?: boolean
    strict?: boolean
  } = {},
) {
  return async function rateLimitedHandler(
    request: T,
    context?: { params?: Record<string, string> },
  ): Promise<Response> {
    // Get rate limit configuration
    const config = options.preset
      ? RateLimitPresets[options.preset]
      : { limit: options.limit || 100, window: options.window || 60 }

    // Determine identifier. `byUser` keys on the user id from the signed session
    // cookie; it used to read an `Authorization: Bearer` value the app never sends
    // (so every "per-user" limit was really per-IP) and that a caller could rotate
    // at will to dodge the limit. Unauthenticated callers fall back to their IP.
    const identifier =
      (options.byUser ? await resolveUserIdentifier(request) : null) ?? getClientIp(request)

    // Apply rate limit
    const result = options.strict
      ? await strictRateLimit(identifier, config.limit, config.window)
      : await rateLimit({
          identifier,
          limit: config.limit,
          window: config.window,
          prefix: options.byUser ? 'ratelimit:user' : 'ratelimit:ip',
        })

    // Return 429 if rate limit exceeded
    if (!result.success) {
      return new Response('Too Many Requests', {
        status: 429,
        headers: {
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(result.reset),
          'Retry-After': String(config.window),
        },
      })
    }

    // Only call handler if rate limit not exceeded
    const response = await handler(request, context)

    // Add rate limit headers to response
    const newHeaders = new Headers(response.headers)
    newHeaders.set('X-RateLimit-Limit', String(result.limit))
    newHeaders.set('X-RateLimit-Remaining', String(result.remaining))
    newHeaders.set('X-RateLimit-Reset', String(result.reset))

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    })
  }
}

/**
 * Rate limit middleware for Next.js API routes
 */
export async function rateLimitMiddleware(
  request: Request,
  options: {
    preset?: RateLimitPreset
    limit?: number
    window?: number
    byUser?: boolean
  } = {},
): Promise<RateLimitResult | Response> {
  const config = options.preset
    ? RateLimitPresets[options.preset]
    : { limit: options.limit || 100, window: options.window || 60 }

  const identifier = options.byUser
    ? request.headers.get('x-user-id') || getClientIp(request)
    : getClientIp(request)

  const result = await rateLimit({
    identifier,
    limit: config.limit,
    window: config.window,
    prefix: options.byUser ? 'ratelimit:user' : 'ratelimit:ip',
  })

  if (!result.success) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(result.reset),
        'Retry-After': String(config.window),
      },
    })
  }

  return result
}
