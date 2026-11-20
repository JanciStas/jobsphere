/**
 * Admin-initiated password reset. Uses the same VerificationToken contract as
 * /api/auth/forgot-password + /api/auth/reset-password (sha256-hashed token,
 * type PASSWORD_RESET, 1 hour), so the user finishes it on the normal
 * reset-password page.
 */

import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { logger } from '@/lib/logger'

const LOCALES = ['sk', 'en', 'de', 'cs', 'pl']

export interface ResetResult {
  /** 'email' when a mail was handed to the provider, 'link' when the admin must pass the link on. */
  delivery: 'email' | 'link'
  /** Present only for delivery === 'link'. A live credential: show once to the admin, never log or audit it. */
  resetUrl?: string
}

export async function issuePasswordReset(
  user: { id: string; email: string; name: string | null },
  locale: string,
  mode: 'email' | 'link',
): Promise<ResetResult> {
  const safeLocale = LOCALES.includes(locale) ? locale : 'en'
  const token = crypto.randomBytes(32).toString('hex')
  const hashed = crypto.createHash('sha256').update(token).digest('hex')

  await prisma.verificationToken.deleteMany({
    where: { identifier: user.email, type: 'PASSWORD_RESET' },
  })
  await prisma.verificationToken.create({
    data: {
      identifier: user.email,
      token: hashed,
      type: 'PASSWORD_RESET',
      expires: new Date(Date.now() + 3600000),
    },
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const resetUrl = `${appUrl}/${safeLocale}/reset-password?token=${token}`

  const providerReady = process.env.EMAIL_SERVICE !== 'log'
  if (mode === 'email' && providerReady) {
    try {
      const result = await sendEmail({
        to: user.email,
        subject: 'Reset Your Password - JobSphere',
        html: `<p>Hi ${escapeHtml(user.name || 'there')},</p><p>A JobSphere administrator started a password reset for your account. <a href="${resetUrl}">Choose a new password</a>. The link expires in 1 hour.</p><p style="word-break:break-all">${resetUrl}</p>`,
        text: `A JobSphere administrator started a password reset for your account.\n\n${resetUrl}\n\nThe link expires in 1 hour.`,
        throwOnError: false,
      })
      // A suppressed recipient is reported as success by sendEmail but nothing is sent.
      if (result.success && !result.suppressed) return { delivery: 'email' }
      logger.warn('Admin password reset e-mail not delivered, falling back to link', {
        userId: user.id,
        suppressed: result.suppressed === true,
      })
    } catch (error) {
      logger.warn('Admin password reset e-mail failed, falling back to link', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'unknown',
      })
    }
  }
  return { delivery: 'link', resetUrl }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
