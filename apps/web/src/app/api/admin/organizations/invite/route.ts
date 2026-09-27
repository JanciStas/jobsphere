import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { hash } from 'bcryptjs'
import { z } from 'zod'
import { requireGlobalAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { handleApiError } from '@/lib/errors'
import { NotFoundError } from '@/lib/api-helpers'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { generateUniqueOrgSlug } from '@/lib/org-slug'
import { sendEmail, getInvitationEmail } from '@/lib/email'

export const runtime = 'nodejs'

/**
 * Two shapes, because this route was doing one job and being asked to do two.
 *
 * Without `orgId` it provisions a brand-new company plus its first admin — the
 * original behaviour. With `orgId` it invites someone into an organisation that
 * already exists, which was previously impossible: the handler called
 * `organization.create` unconditionally, so "invite this person to that company"
 * silently produced a second company with the same name.
 */
const inviteOrgSchema = z
  .object({
    orgId: z.string().min(1).optional(),
    orgName: z.string().min(1).max(200).optional(),
    adminEmail: z.string().email('A valid admin email is required'),
    industry: z.string().max(100).optional(),
    role: z.enum(['ORG_ADMIN', 'RECRUITER', 'SUB_HR', 'HIRING_MANAGER', 'AGENCY']).optional(),
  })
  .refine((data) => Boolean(data.orgId) !== Boolean(data.orgName), {
    message: 'Provide either orgId (existing organization) or orgName (new one), not both',
  })

/**
 * POST /api/admin/organizations/invite
 *
 * Superadmin-only: provision a brand-new company plus its first ORG_ADMIN and
 * email them a set-password invite link.
 *
 * The org + user + membership (+ set-password token for new users) are created
 * atomically in a single $transaction. The invite email is sent best-effort
 * AFTER the transaction commits, so a mail outage never rolls back a valid
 * provisioning (mirrors the members-route pattern) — the response carries an
 * `emailSent` flag so the UI can warn instead of silently reporting success.
 */
export const POST = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      try {
        const session = await requireGlobalAdmin()
        if (!session) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const body = await req.json()
        const { orgId, orgName, adminEmail, industry, role } = inviteOrgSchema.parse(body)
        const memberRole = role ?? 'ORG_ADMIN'
        const email = adminEmail.toLowerCase()

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

        // Provision org + admin user + membership atomically. `actionUrl` / the
        // email are computed here but only SENT after the txn commits.
        const result = await prisma.$transaction(async (tx) => {
          let organization
          if (orgId) {
            const existing = await tx.organization.findUnique({
              where: { id: orgId },
              select: { id: true, name: true, slug: true },
            })
            if (!existing) {
              throw new NotFoundError('Organization not found')
            }
            organization = existing
          } else {
            const slug = await generateUniqueOrgSlug(orgName!, tx)
            organization = await tx.organization.create({
              data: {
                name: orgName!.trim(),
                slug,
                industry: industry || null,
              },
              select: { id: true, name: true, slug: true },
            })
          }

          let user = await tx.user.findUnique({ where: { email } })
          const isNewUser = !user

          let actionUrl = `${appUrl}/login`
          if (!user) {
            // New account: store a password hash (real password chosen via the
            // set-password link) and issue a 7-day set-password token.
            const tempPassword = crypto.randomBytes(16).toString('hex')
            const hashedPassword = await hash(tempPassword, 12)

            user = await tx.user.create({
              data: {
                email,
                password: hashedPassword,
                name: email.split('@')[0],
              },
            })

            const inviteToken = crypto.randomUUID()
            await tx.verificationToken.create({
              data: {
                identifier: email,
                token: inviteToken,
                expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              },
            })
            actionUrl = `${appUrl}/reset-password?token=${inviteToken}`
          }

          // upsert, not create: inviting someone who is already in this
          // organisation should adjust their role rather than blow up on the
          // composite unique key.
          await tx.userOrgRole.upsert({
            where: { userId_orgId: { userId: user.id, orgId: organization.id } },
            create: { userId: user.id, orgId: organization.id, role: memberRole },
            // deletedAt: null reinstates a previously removed member; without it the
            // invite reported success while the member stayed removed.
            update: { role: memberRole, deletedAt: null },
          })

          return { organization, userEmail: user.email, isNewUser, actionUrl }
        })

        // Best-effort invite email (never fails the request).
        let emailSent = true
        try {
          const emailResult = await sendEmail({
            to: result.userEmail,
            // The organisation's real name, not the request field: with `orgId`
            // there is no orgName in the body at all, and using it would have
            // emailed "You've been added to undefined".
            subject: result.isNewUser
              ? `You're invited to join ${result.organization.name} on JobSphere`
              : `You've been added to ${result.organization.name}`,
            html: getInvitationEmail({
              isNewUser: result.isNewUser,
              orgName: result.organization.name,
              role: memberRole,
              actionUrl: result.actionUrl,
            }),
          })
          if (!emailResult.success) emailSent = false
        } catch (emailError) {
          emailSent = false
          logger.error('Failed to send org invitation email:', emailError)
        }

        logger.info(
          `Admin invited organization ${result.organization.id} (${orgName}) by ${session.user.id}`,
        )

        await createAuditLog({
          userId: session.user.id,
          orgId: result.organization.id,
          action: 'CREATE',
          resource: 'ORGANIZATION',
          resourceId: result.organization.id,
          metadata: { name: orgName, adminEmail, emailSent, viaInvite: true },
          ...getRequestMetadata(req),
        })

        return NextResponse.json(
          {
            organization: result.organization,
            emailSent,
            message: emailSent
              ? 'Organization created and invitation sent'
              : 'Organization created, but the invitation e-mail could not be sent — check the e-mail (Resend) configuration.',
          },
          { status: 201 },
        )
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'Validation failed', issues: error.issues },
            { status: 400 },
          )
        }
        logger.error('Admin POST /organizations/invite error:', error)
        return handleApiError(error)
      }
    },
    { preset: 'api' },
  ),
)
