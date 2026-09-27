import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { hash } from 'bcryptjs'
import { logger } from '@/lib/logger'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'
import { sendEmail, getInvitationEmail } from '@/lib/email'

export const runtime = 'nodejs'

const inviteMemberSchema = z.object({
  email: z.string().email(),
  // SUB_HR = a sub-HR member managed by the main HR (ORG_ADMIN): works with
  // candidates/applications/pipeline but not billing, members or org settings.
  role: z.enum(['ORG_ADMIN', 'RECRUITER', 'SUB_HR', 'HIRING_MANAGER', 'AGENCY']),
})

export const GET = withRateLimit(
  async function GET(request: Request) {
    try {
      const session = await auth()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Parse pagination params
      const { searchParams } = new URL(request.url)
      const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
      const limit = Math.min(
        100,
        Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50),
      )
      const skip = (page - 1) * limit

      // Get user's organization
      const userOrgRole = await prisma.userOrgRole.findFirst({
        where: {
          userId: session.user.id,
          deletedAt: null,
          ...(session.user.activeOrgId ? { orgId: session.user.activeOrgId } : {}),
        },
      })

      if (!userOrgRole) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
      }

      // Get paginated team members and total count in parallel
      const where = {
        orgId: userOrgRole.orgId,
        deletedAt: null,
      }

      const members = await prisma.userOrgRole.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: limit,
        skip,
      })
      const total = await prisma.userOrgRole.count({ where })

      return NextResponse.json({
        members,
        currentUserRole: userOrgRole.role,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      })
    } catch (error) {
      logger.error('Error fetching team members:', error)
      return NextResponse.json({ error: 'Failed to fetch team members' }, { status: 500 })
    }
  },
  { preset: 'api' },
)

export const POST = withCsrfProtection(
  withRateLimit(
    async function POST(request: Request) {
      try {
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get user's organization and verify admin role
        const userOrgRole = await prisma.userOrgRole.findFirst({
          where: {
            userId: session.user.id,
            role: 'ORG_ADMIN',
            deletedAt: null,
            ...(session.user.activeOrgId ? { orgId: session.user.activeOrgId } : {}),
          },
          include: {
            organization: { select: { name: true } },
          },
        })

        if (!userOrgRole) {
          return NextResponse.json(
            { error: 'Forbidden - Only organization admins can invite members' },
            { status: 403 },
          )
        }

        const body = await request.json()
        const { email, role } = inviteMemberSchema.parse(body)

        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        const orgName = userOrgRole.organization?.name || 'your organization'

        // Tracks whether the invite/notification e-mail actually left the system,
        // so the UI can warn the admin instead of silently reporting success.
        let inviteEmailSent = true

        // Check if user already exists
        let user = await prisma.user.findUnique({
          where: { email },
        })
        const isNewUser = !user

        // If user doesn't exist, create a new user account
        if (!user) {
          // Generate a random temporary password (the account still needs a
          // password hash). The user sets their real password via the invite
          // link below.
          const tempPassword = crypto.randomBytes(16).toString('hex')
          const hashedPassword = await hash(tempPassword, 12)

          user = await prisma.user.create({
            data: {
              email,
              password: hashedPassword,
              name: email.split('@')[0], // Use email prefix as default name
            },
          })

          // Issue a set-password (reset-password) token so the invited user can
          // choose their own password and log in. resetPassword() looks this up
          // by plaintext token value, so a plaintext UUID is a valid link.
          const inviteToken = crypto.randomUUID()
          await prisma.verificationToken.create({
            data: {
              identifier: email,
              token: inviteToken,
              expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            },
          })
          const actionUrl = `${appUrl}/reset-password?token=${inviteToken}`

          // Best-effort invite email — never fail the request if email fails,
          // but remember whether it actually left so the UI can warn the admin.
          try {
            const emailResult = await sendEmail({
              to: email,
              subject: `You're invited to join ${orgName} on JobSphere`,
              html: getInvitationEmail({ isNewUser: true, orgName, role, actionUrl }),
            })
            if (!emailResult.success) inviteEmailSent = false
          } catch (emailError) {
            inviteEmailSent = false
            logger.error('Failed to send invitation email to new user:', emailError)
          }
        }

        // Check if user is already a member
        const existingMember = await prisma.userOrgRole.findUnique({
          where: {
            userId_orgId: {
              userId: user.id,
              orgId: userOrgRole.orgId,
            },
          },
        })

        if (existingMember && !existingMember.deletedAt) {
          return NextResponse.json(
            { error: 'User is already a member of this organization' },
            { status: 400 },
          )
        }

        const memberInclude = {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        }

        // (userId, orgId) is the primary key, so a previously removed member cannot be
        // created again — reinstate the soft-deleted row with the new role instead.
        const newMember = existingMember
          ? await prisma.userOrgRole.update({
              where: { userId_orgId: { userId: user.id, orgId: userOrgRole.orgId } },
              data: { role, deletedAt: null },
              include: memberInclude,
            })
          : await prisma.userOrgRole.create({
              data: {
                userId: user.id,
                orgId: userOrgRole.orgId,
                role,
              },
              include: memberInclude,
            })

        // Best-effort notification email for users who already had an account.
        // New users were already emailed the set-password invite above, so we
        // do not double-send. Never fail the request if email fails.
        if (!isNewUser) {
          try {
            const actionUrl = `${appUrl}/login`
            const emailResult = await sendEmail({
              to: user.email,
              subject: `You've been added to ${orgName}`,
              html: getInvitationEmail({ isNewUser: false, orgName, role, actionUrl }),
            })
            if (!emailResult.success) inviteEmailSent = false
          } catch (emailError) {
            inviteEmailSent = false
            logger.error('Failed to send notification email to existing user:', emailError)
          }
        }

        return NextResponse.json({
          member: newMember,
          emailSent: inviteEmailSent,
          message: inviteEmailSent
            ? 'Member invited successfully'
            : 'Member added, but the invitation e-mail could not be sent — check the e-mail (Resend) configuration.',
        })
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'Invalid request data', details: error.errors },
            { status: 400 },
          )
        }

        logger.error('Error inviting team member:', error)
        return NextResponse.json({ error: 'Failed to invite team member' }, { status: 500 })
      }
    },
    { preset: 'strict', byUser: true },
  ),
)
