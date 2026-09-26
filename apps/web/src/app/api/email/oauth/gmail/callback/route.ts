/**
 * Gmail OAuth Callback
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/encryption'
import { logger } from '@/lib/logger'
import { withRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

// OAuth state validation schema
const oauthStateSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  timestamp: z.number().positive('Timestamp must be positive'),
})

async function handleGmailCallback(request: NextRequest) {
  const baseUrl = request.nextUrl.origin

  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

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

    if (Date.now() - timestamp > 5 * 60 * 1000) {
      return NextResponse.redirect(`${baseUrl}/employer/settings?error=state_expired`)
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        redirect_uri: `${baseUrl}/api/email/oauth/gmail/callback`,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResponse.ok) {
      logger.error('Gmail OAuth token exchange failed', { status: tokenResponse.status })
      return NextResponse.redirect(`${baseUrl}/employer/settings?error=token_failed`)
    }

    const tokens = await tokenResponse.json()
    const { access_token, refresh_token, expires_in } = tokens

    // Get user email
    const userResponse = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${access_token}` },
    })

    if (!userResponse.ok) {
      return NextResponse.redirect(`${baseUrl}/employer/settings?error=user_info_failed`)
    }

    const user = await userResponse.json()
    const email = user.email

    // Find organization
    const orgMember = await prisma.userOrgRole.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })

    if (!orgMember) {
      return NextResponse.redirect(`${baseUrl}/employer/settings?error=no_org`)
    }

    // Encrypt OAuth tokens before storing
    const encryptedTokens = encrypt(
      JSON.stringify({
        access_token,
        refresh_token,
        expires_in,
        token_type: 'Bearer',
        expiry_date: Date.now() + expires_in * 1000,
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
        provider: 'GMAIL',
        orgId: orgMember.orgId,
        name: user.name || email,
        oauthJson: encryptedTokens,
        isActive: true,
      },
      update: {
        oauthJson: encryptedTokens,
        isActive: true,
        lastSyncAt: new Date(),
      },
    })

    return NextResponse.redirect(
      `${baseUrl}/employer/settings?success=email_connected&email=${encodeURIComponent(email)}`,
    )
  } catch (error) {
    logger.error('Gmail OAuth callback error', { error })
    return NextResponse.redirect(`${baseUrl}/employer/settings?error=callback_failed`)
  }
}

// Rate limiting was missing on this handler until the route wrapper contract
// test (tests/security/route-wrapper-contract.test.ts) enumerated the API surface.
export const GET = withRateLimit(handleGmailCallback, { preset: 'strict' })
