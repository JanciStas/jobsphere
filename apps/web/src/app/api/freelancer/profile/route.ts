/**
 * Freelancer profile API — read + update the logged-in user's own freelancer profile.
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { httpUrl } from '../portfolio/schema'

export const GET = withRateLimit(
  async () => {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const profile = await prisma.freelancerProfile.findUnique({
      where: { userId: session.user.id },
    })
    return NextResponse.json({ profile })
  },
  { preset: 'api' },
)

const updateSchema = z.object({
  title: z.string().max(120).optional(),
  bio: z.string().max(4000).optional(),
  services: z.array(z.string().min(1).max(80)).max(30).optional(),
  skills: z.array(z.string().min(1).max(60)).max(50).optional(),
  hourlyRate: z.number().int().min(0).max(100000).nullable().optional(),
  currency: z.string().max(8).optional(),
  availability: z.enum(['AVAILABLE', 'LIMITED', 'UNAVAILABLE']).optional(),
  location: z.string().max(120).optional(),
  portfolioUrl: httpUrl.optional().or(z.literal('')),
  visible: z.boolean().optional(),
})

export const PUT = withCsrfProtection(
  withRateLimit(
    async (request: Request) => {
      try {
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const body = await request.json()
        const parsed = updateSchema.safeParse(body)
        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Invalid data', details: parsed.error.errors },
            { status: 400 },
          )
        }

        // Normalize: empty portfolio URL → cleared.
        const data = { ...parsed.data }
        if (data.portfolioUrl === '') data.portfolioUrl = undefined

        // Upsert so the profile exists even if the account predates the freelancer role.
        const profile = await prisma.freelancerProfile.upsert({
          where: { userId: session.user.id },
          create: { userId: session.user.id, ...data },
          update: data,
        })

        return NextResponse.json({ profile })
      } catch (error) {
        logger.error('Freelancer profile update error', { error })
        return NextResponse.json({ error: 'Failed to save profile' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)
