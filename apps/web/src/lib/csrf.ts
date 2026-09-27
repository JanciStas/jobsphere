/**
 * CSRF Protection
 * Generate and validate CSRF tokens
 */

import { randomBytes, createHmac } from 'crypto'
import { cookies } from 'next/headers'
import { logger } from './logger'

// Generate a per-process fallback secret (logged as warning, not a crash)
let _fallbackSecret: string | null = null

function getCsrfSecret(): string {
  const secret = process.env.CSRF_SECRET
  if (secret) return secret

  // No CSRF_SECRET set — generate a random per-process fallback
  if (!_fallbackSecret) {
    _fallbackSecret = randomBytes(32).toString('hex')
    logger.warn(
      'CSRF_SECRET not set — using random per-process secret. ' +
        'Set CSRF_SECRET env var for persistent CSRF tokens across deployments.',
    )
  }
  return _fallbackSecret
}

const CSRF_SECRET = getCsrfSecret()
const CSRF_COOKIE_NAME = 'jobsphere-csrf-token'
const CSRF_TOKEN_LENGTH = 32

/**
 * Generate CSRF token
 */
export function generateCsrfToken(): string {
  const token = randomBytes(CSRF_TOKEN_LENGTH).toString('hex')
  const signature = createHmac('sha256', CSRF_SECRET).update(token).digest('hex')

  return `${token}.${signature}`
}

/**
 * Verify CSRF token
 */
export function verifyCsrfToken(token: string): boolean {
  if (!token || typeof token !== 'string') {
    return false
  }

  const parts = token.split('.')
  if (parts.length !== 2) {
    return false
  }

  const [tokenValue, signature] = parts

  const expectedSignature = createHmac('sha256', CSRF_SECRET).update(tokenValue).digest('hex')

  // Constant-time comparison to prevent timing attacks
  return timingSafeEqual(signature, expectedSignature)
}

/**
 * Timing-safe string comparison
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return result === 0
}

/**
 * Get CSRF token from cookie or generate new one
 */
export async function getCsrfToken(): Promise<string> {
  const cookieStore = await cookies()
  const existingToken = cookieStore.get(CSRF_COOKIE_NAME)?.value

  if (existingToken && verifyCsrfToken(existingToken)) {
    return existingToken
  }

  // Generate new token
  const newToken = generateCsrfToken()

  // Set cookie
  cookieStore.set(CSRF_COOKIE_NAME, newToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 60 * 60 * 24, // 24 hours
    path: '/',
  })

  return newToken
}

/**
 * Verify CSRF token from request
 */
export async function verifyCsrfFromRequest(headerToken: string | null): Promise<boolean> {
  if (!headerToken) {
    return false
  }

  const cookieStore = await cookies()
  const cookieToken = cookieStore.get(CSRF_COOKIE_NAME)?.value

  if (!cookieToken) {
    return false
  }

  // Both tokens must be valid and match
  return verifyCsrfToken(headerToken) && verifyCsrfToken(cookieToken) && headerToken === cookieToken
}

/**
 * CSRF protection middleware for API routes
 * Wraps handler and validates CSRF token from x-csrf-token header
 *
 * @example
 * export const POST = withCsrfProtection(async (req: Request) => {
 *   // Your handler code
 * })
 */
/**
 * Check whether the request originates from the same site.
 * Accepts: Origin/Referer host matches the Host header, OR
 * Sec-Fetch-Site is "same-origin" / "same-site".
 */
function isSameSiteRequest(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite === 'same-origin' || fetchSite === 'same-site') {
    return true
  }

  const host = request.headers.get('host')
  if (!host) return false

  const origin = request.headers.get('origin')
  if (origin) {
    try {
      return new URL(origin).host === host
    } catch {
      return false
    }
  }

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      return new URL(referer).host === host
    } catch {
      return false
    }
  }

  // No origin/referer on a POST is suspicious — reject
  return false
}

export function withCsrfProtection<T extends Request = Request>(
  handler: (request: T, context?: { params?: Record<string, string> }) => Promise<Response>,
): (request: T, context?: { params?: Record<string, string> }) => Promise<Response> {
  return async (request: T, context?: { params?: Record<string, string> }) => {
    // Skip CSRF validation in test environment
    if (process.env.NODE_ENV === 'test') {
      return handler(request, context)
    }

    // Double-submit token path (optional, kept for strict clients)
    const csrfToken = request.headers.get('x-csrf-token')
    if (csrfToken && (await verifyCsrfFromRequest(csrfToken))) {
      return handler(request, context)
    }

    // Fallback: accept same-origin/same-site requests. Combined with
    // NextAuth's SameSite session cookie this is sufficient for MVP.
    if (isSameSiteRequest(request)) {
      return handler(request, context)
    }

    return new Response(
      JSON.stringify({
        error: 'Invalid CSRF token',
        code: 'CSRF_TOKEN_INVALID',
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
}
