/**
 * Microsoft 365 OAuth Flow
 * Pripojenie firemného emailu cez Microsoft Graph API
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

const MICROSOFT_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'

const SCOPES = [
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/User.Read',
  'offline_access',
].join(' ')

/**
 * GET /api/email/oauth/microsoft
 * Inicializuje OAuth flow
 */
async function startMicrosoftOAuth(request: NextRequest) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID
    const baseUrl = request.nextUrl.origin
    const redirectUri = `${baseUrl}/api/email/oauth/microsoft/callback`

    if (!clientId) {
      return NextResponse.json({ error: 'Microsoft OAuth not configured' }, { status: 500 })
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

    const authUrl = new URL(MICROSOFT_AUTH_URL)
    authUrl.searchParams.set('client_id', clientId)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', redirectUri)
    authUrl.searchParams.set('scope', SCOPES)
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('response_mode', 'query')

    return NextResponse.redirect(authUrl.toString())
  } catch (error) {
    logger.error('Microsoft OAuth init error', { error })
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
 * POST /api/email/oauth/microsoft
 * Manuálne pridanie access tokenu (pre testovanie)
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

        // Find user's organization
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

        // Create or update email account
        const emailAccount = await prisma.emailAccount.upsert({
          where: {
            orgId_email: {
              email,
              orgId: orgMember.orgId,
            },
          },
          create: {
            email,
            provider: 'MICROSOFT',
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
        logger.error('Microsoft OAuth save error', { error })
        return NextResponse.json({ error: 'Failed to save account' }, { status: 500 })
      }
    },
    { preset: 'api', byUser: true },
  ),
)

// Rate limiting was missing on this handler until the route wrapper contract
// test (tests/security/route-wrapper-contract.test.ts) enumerated the API surface.
export const GET = withRateLimit(startMicrosoftOAuth, { preset: 'strict', byUser: true })
