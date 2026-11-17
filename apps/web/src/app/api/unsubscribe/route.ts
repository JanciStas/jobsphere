/**
 * GET /api/unsubscribe?email=...&token=... (LOGIC-011)
 *
 * One-click unsubscribe endpoint. Verifies an HMAC-signed token for the email
 * and, on success, upserts an EmailSuppressionList row (reason: UNSUBSCRIBED).
 * Returns a simple HTML confirmation page. No auth required (the token is the
 * capability), but rate-limited to prevent abuse.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { withRateLimit } from '@/lib/rate-limit'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe'
import { maskEmail } from '@/lib/mask-email'

export const runtime = 'nodejs'

function htmlPage(title: string, message: string, status: number): NextResponse {
  const body = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${title}</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f9fafb; color: #111827; margin: 0; padding: 0; }
      .card { max-width: 480px; margin: 80px auto; background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
      h1 { font-size: 20px; margin-bottom: 12px; }
      p { color: #6b7280; line-height: 1.6; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${message}</p>
    </div>
  </body>
</html>`
  return new NextResponse(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export const GET = withRateLimit(
  async (req: NextRequest) => {
    const { searchParams } = new URL(req.url)
    const email = searchParams.get('email')?.trim().toLowerCase()
    const token = searchParams.get('token')

    if (!email || !token) {
      return htmlPage(
        'Invalid unsubscribe link',
        'This unsubscribe link is missing required information.',
        400,
      )
    }

    if (!verifyUnsubscribeToken(email, token)) {
      logger.warn('Unsubscribe rejected — invalid token', { email: maskEmail(email) })
      return htmlPage(
        'Invalid unsubscribe link',
        'This unsubscribe link is invalid or has expired.',
        400,
      )
    }

    try {
      await prisma.emailSuppressionList.upsert({
        where: { email },
        create: {
          email,
          reason: 'UNSUBSCRIBED',
          metadata: { source: 'unsubscribe-link', at: new Date().toISOString() },
        },
        update: {
          reason: 'UNSUBSCRIBED',
          metadata: { source: 'unsubscribe-link', at: new Date().toISOString() },
        },
      })

      logger.info('Recipient unsubscribed', { email: maskEmail(email) })

      return htmlPage(
        'You have been unsubscribed',
        'You will no longer receive marketing or sequence emails from us. We are sorry to see you go.',
        200,
      )
    } catch (error) {
      logger.error('Failed to process unsubscribe', {
        email: maskEmail(email),
        error: error instanceof Error ? error.message : String(error),
      })
      return htmlPage(
        'Something went wrong',
        'We could not process your request right now. Please try again later.',
        500,
      )
    }
  },
  { preset: 'public' },
)
