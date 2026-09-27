/**
 * Gmail OAuth Flow
 * Pripojenie Gmailu cez Google OAuth
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveActiveMembership } from '@/lib/api-helpers'
import { encrypt } from '@/lib/encryption'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ')

/**
 * GET /api/email/oauth/gmail
 * Inicializuje Gmail OAuth flow
 */
async function startGmailOAuth(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const clientId = process.env.GOOGLE_CLIENT_ID
    const baseUrl = request.nextUrl.origin
    const redirectUri = `${baseUrl}/api/email/oauth/gmail/callback`

    if (!clientId) {
      return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 })
    }

    // Generate HMAC-signed state token to prevent forgery
    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) {
      return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
    }
    const payload = Buffer.from(
      JSON.stringify({ userId: session.user.id, timestamp: Date.now() }),
    ).toString('base64')
    const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
    const state = `${payload}.${sig}`

    const authUrl = new URL(GOOGLE_AUTH_URL)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('scope', SCOPES)
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('access_type', 'offline')
    authUrl.searchParams.set('prompt', 'consent')

    return NextResponse.redirect(authUrl.toString())
  } catch (error) {
    logger.error('Gmail OAuth init error', { error })
    return NextResponse.json({ error: 'Failed to initialize OAuth' }, { status: 500 })
  }
}

// Manual token payload validation
const manualTokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  email: z.string().email(),
})

/**
 * POST /api/email/oauth/gmail
 * Manuálne pridanie Gmail tokenu
 */
export const POST = withCsrfProtection<NextRequest>(
  withRateLimit<NextRequest>(
    async (request: NextRequest) => {
      try {
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const parsed = manualTokenSchema.safeParse(await request.json())
        if (!parsed.success) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }
        const { accessToken, refreshToken, email } = parsed.data

        const orgMember = await resolveActiveMembership(session.user.id, session.user.activeOrgId)

        if (!orgMember) {
          return NextResponse.json({ error: 'User not in organization' }, { status: 400 })
        }

        // Encrypt OAuth tokens before storing
        const encryptedTokens = encrypt(
          JSON.stringify({
            access_token: accessToken,
            refresh_token: refreshToken,
            expires_in: 3600,
            token_type: 'Bearer',
          }),
        )

        const emailAccount = await prisma.emailAccount.upsert({
          where: {
            orgId_email: {
              email,
              orgId: orgMember.orgId,
            },
          },
          create: {
            email,
            provider: 'GMAIL',
            orgId: orgMember.orgId,
            oauthJson: encryptedTokens,
            isActive: true,
          },
          update: {
            oauthJson: encryptedTokens,
            isActive: true,
            lastSyncAt: new Date(),
          },
        })

        return NextResponse.json({
          success: true,
          accountId: emailAccount.id,
          email: emailAccount.email,
        })
      } catch (error) {
        logger.error('Gmail OAuth save error', { error })
        return NextResponse.json({ error: 'Failed to save account' }, { status: 500 })
      }
    },
    { preset: 'api', byUser: true },
  ),
)

// Rate limiting was missing on this handler until the route wrapper contract
// test (tests/security/route-wrapper-contract.test.ts) enumerated the API surface.
export const GET = withRateLimit(startGmailOAuth, { preset: 'strict', byUser: true })
