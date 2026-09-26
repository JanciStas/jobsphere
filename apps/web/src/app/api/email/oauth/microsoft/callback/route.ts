/**
 * Microsoft OAuth Callback
 * Spracuje authorization code a získa access token
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/encryption'
import { logger } from '@/lib/logger'
import { withRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const MICROSOFT_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const MICROSOFT_GRAPH_URL = 'https://graph.microsoft.com/v1.0'

// OAuth state validation schema
const oauthStateSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  timestamp: z.number().positive('Timestamp must be positive'),
})

async function handleMicrosoftCallback(request: NextRequest) {
  const baseUrl = request.nextUrl.origin

  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

    // Check for errors
    if (error) {
      return NextResponse.redirect(`${baseUrl}/employer/settings?error=oauth_failed`)
    }

    if (!code || !state) {
      return NextResponse.redirect(`${baseUrl}/employer/settings?error=invalid_callback`)
    }

    // Verify HMAC signature and validate state
    let stateData
    try {
      const [payload, sig] = state.split('.')
      if (!payload || !sig) {
        return NextResponse.redirect(`${baseUrl}/employer/settings?error=invalid_state`)
      }
      const secret = process.env.NEXTAUTH_SECRET
      if (!secret) {
        return NextResponse.redirect(`${baseUrl}/employer/settings?error=server_error`)
      }
      const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
      const sigBuf = Buffer.from(sig)
      const expectedBuf = Buffer.from(expectedSig)
      if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        return NextResponse.redirect(`${baseUrl}/employer/settings?error=invalid_state`)
      }
      const rawState = JSON.parse(Buffer.from(payload, 'base64').toString())
      stateData = oauthStateSchema.parse(rawState)
    } catch {
      return NextResponse.redirect(`${baseUrl}/employer/settings?error=invalid_state`)
    }

    const { userId, timestamp } = stateData

    // Check state freshness (5 minutes)
    if (Date.now() - timestamp > 5 * 60 * 1000) {
      return NextResponse.redirect(`${baseUrl}/employer/settings?error=state_expired`)
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(MICROSOFT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID!,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
        code,
        redirect_uri: `${baseUrl}/api/email/oauth/microsoft/callback`,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json()
      logger.error('Microsoft OAuth token exchange failed', {
        status: tokenResponse.status,
        errorData,
      })
      return NextResponse.redirect(`${baseUrl}/employer/settings?error=token_failed`)
    }

    const tokens = await tokenResponse.json()
    const { access_token, refresh_token, expires_in } = tokens

    // Get user email from Microsoft Graph
    const userResponse = await fetch(`${MICROSOFT_GRAPH_URL}/me`, {
      headers: { Authorization: `Bearer ${access_token}` },
    })

    if (!userResponse.ok) {
      logger.error('Microsoft OAuth failed to get user info', { status: userResponse.status })
      return NextResponse.redirect(`${baseUrl}/employer/settings?error=user_info_failed`)
    }

    const user = await userResponse.json()
    const email = user.mail || user.userPrincipalName

    // Find user's organization
    const orgMember = await prisma.userOrgRole.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })

    if (!orgMember) {
      return NextResponse.redirect(`${baseUrl}/employer/settings?error=no_org`)
    }

    // Encrypt OAuth tokens for secure storage (parity with Gmail)
    const encryptedTokens = encrypt(
      JSON.stringify({
        access_token,
        refresh_token,
        expires_in,
        token_type: 'Bearer',
      }),
    )

    // Save email account
    await prisma.emailAccount.upsert({
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
        name: user.displayName || email,
        oauthJson: encryptedTokens,
        isActive: true,
      },
      update: {
        oauthJson: encryptedTokens,
        isActive: true,
        lastSyncAt: new Date(),
      },
    })

    // Redirect to settings with success
    return NextResponse.redirect(
      `${baseUrl}/employer/settings?success=email_connected&email=${encodeURIComponent(email)}`,
    )
  } catch (error) {
    logger.error('Microsoft OAuth callback error', { error })
    return NextResponse.redirect(`${baseUrl}/employer/settings?error=callback_failed`)
  }
}

// Rate limiting was missing on this handler until the route wrapper contract
// test (tests/security/route-wrapper-contract.test.ts) enumerated the API surface.
export const GET = withRateLimit(handleMicrosoftCallback, { preset: 'strict' })
