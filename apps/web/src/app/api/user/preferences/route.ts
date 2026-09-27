import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveActiveMembership } from '@/lib/api-helpers'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'

export const runtime = 'nodejs'

const preferencesSchema = z.object({
  preferences: z.object({
    emailNotifications: z.object({
      newApplication: z.boolean(),
      applicationStatusChange: z.boolean(),
      newTeamMember: z.boolean(),
      billingUpdates: z.boolean(),
      weeklyDigest: z.boolean(),
      marketingEmails: z.boolean(),
    }),
    inAppNotifications: z.object({
      newApplication: z.boolean(),
      applicationStatusChange: z.boolean(),
      newTeamMember: z.boolean(),
      mentions: z.boolean(),
    }),
    digestFrequency: z.enum(['immediate', 'daily', 'weekly']),
  }),
})

export const GET = withRateLimit(
  async (_req: Request) => {
    try {
      const session = await auth()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      // Get user's organization to access settings
      const userOrgRole = await resolveActiveMembership(session.user.id, session.user.activeOrgId, {
        organization: { select: { settings: true } },
      })

      if (!userOrgRole) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
      }

      // Get user preferences from organization settings
      const settings = userOrgRole.organization.settings as any
      const userPreferences = settings?.userPreferences?.[session.user.id] || null

      return NextResponse.json({
        preferences: userPreferences,
      })
    } catch (error) {
      logger.error('Error fetching user preferences:', error)
      return NextResponse.json({ error: 'Failed to fetch user preferences' }, { status: 500 })
    }
  },
  { preset: 'api' },
)

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      try {
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get user's organization
        const userOrgRole = await resolveActiveMembership(session.user.id, session.user.activeOrgId)

        if (!userOrgRole) {
          return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
        }

        const body = await req.json()
        const { preferences } = preferencesSchema.parse(body)

        // Get current organization settings
        const organization = await prisma.organization.findUnique({
          where: { id: userOrgRole.orgId },
          select: { settings: true },
        })

        const currentSettings = (organization?.settings as any) || {}
        const userPreferences = currentSettings.userPreferences || {}

        // Update user preferences in organization settings
        userPreferences[session.user.id] = preferences

        await prisma.organization.update({
          where: { id: userOrgRole.orgId },
          data: {
            settings: {
              ...currentSettings,
              userPreferences,
            },
          },
        })

        return NextResponse.json({
          preferences,
          message: 'Preferences updated successfully',
        })
      } catch (error) {
        if (error instanceof z.ZodError) {
          return NextResponse.json(
            { error: 'Invalid request data', details: error.errors },
            { status: 400 },
          )
        }

        logger.error('Error updating user preferences:', error)
        return NextResponse.json({ error: 'Failed to update user preferences' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)
