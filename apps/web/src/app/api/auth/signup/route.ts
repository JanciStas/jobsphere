import { NextResponse } from 'next/server'
import { hash } from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { withRateLimit } from '@/lib/rate-limit'
import { z } from 'zod'
import { validateRequest, strongPasswordSchema, ValidationError } from '@/lib/validation'
import { logger } from '@/lib/logger'
import { UserService } from '@/services/user.service'

export const runtime = 'nodejs'

const signupSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address'),
  password: strongPasswordSchema,
  role: z.enum(['candidate', 'employer', 'agency', 'freelancer']).optional().default('candidate'),
  companyName: z.string().optional(),
})

// AUTH-008: identical response for every successful-path outcome (new account
// created OR email already registered) so the endpoint never reveals whether an
// account exists for a given email.
const GENERIC_SIGNUP_RESPONSE = {
  success: true,
  message:
    'If this email is available, your account has been created. Please check your inbox to verify your email address.',
}

export const POST = withRateLimit(
  async (req: Request) => {
    try {
      // Validate request body
      const data = await validateRequest(req, signupSchema)
      data.email = data.email.toLowerCase()

      // Employers and agencies both own an Organization -> company name is mandatory
      const createsOrg = data.role === 'employer' || data.role === 'agency'
      if (createsOrg && !data.companyName?.trim()) {
        return NextResponse.json(
          {
            error:
              data.role === 'agency'
                ? 'Company name is required for agencies'
                : 'Company name is required for employers',
          },
          { status: 400 },
        )
      }

      // AUTH-008: do NOT branch the response on whether the email exists.
      // If it's already taken, silently return the generic success response so
      // an attacker cannot enumerate registered emails.
      const existingUser = await prisma.user.findUnique({
        where: { email: data.email },
      })

      if (existingUser) {
        logger.info('Signup attempt for existing email (generic response returned)')
        return NextResponse.json(GENERIC_SIGNUP_RESPONSE, { status: 201 })
      }

      // Hash password
      const hashedPassword = await hash(data.password, 12)

      // Create user and organization in a transaction
      await prisma.$transaction(async (tx) => {
        // AUTH-009: create the user UNVERIFIED. emailVerified is set only after
        // the user clicks the verification link (see /api/auth/verify-email).
        const newUser = await tx.user.create({
          data: {
            name: data.name,
            email: data.email,
            password: hashedPassword,
          },
        })

        // Employer / agency: create the organization and link the user to it
        if (createsOrg && data.companyName) {
          // Generate unique slug
          const baseSlug = data.companyName
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '')
          let slug = baseSlug
          let counter = 1

          // Check for slug uniqueness and add counter if needed
          while (await tx.organization.findUnique({ where: { slug } })) {
            slug = `${baseSlug}-${counter}`
            counter++
          }

          const organization = await tx.organization.create({
            data: {
              name: data.companyName.trim(),
              slug,
            },
          })

          await tx.userOrgRole.create({
            data: {
              userId: newUser.id,
              orgId: organization.id,
              // Agencies get the dedicated AGENCY role, employers stay ORG_ADMIN
              role: data.role === 'agency' ? 'AGENCY' : 'ORG_ADMIN',
            },
          })
        }

        // If freelancer, create an (empty) freelancer profile — no organization.
        if (data.role === 'freelancer') {
          await tx.freelancerProfile.create({
            data: { userId: newUser.id },
          })
        }

        return newUser
      })

      // AUTH-009: issue a verification token + email outside the create txn.
      await UserService.createEmailVerificationToken(data.email)

      return NextResponse.json(GENERIC_SIGNUP_RESPONSE, { status: 201 })
    } catch (error) {
      if (error instanceof ValidationError) {
        return NextResponse.json(
          {
            error: error.issues[0]?.message || 'Validation failed',
            issues: error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          },
          { status: 400 },
        )
      }
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          { error: 'Validation failed', issues: error.issues },
          { status: 400 },
        )
      }

      logger.error('Signup error:', error)
      return NextResponse.json({ error: 'An error occurred during signup' }, { status: 500 })
    }
  },
  { preset: 'strict' }, // 10 requests per 15 minutes
)
