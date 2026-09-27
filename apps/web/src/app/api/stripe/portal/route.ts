/**
 * Stripe Customer Portal
 * Redirect to Stripe billing portal for subscription management
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveActiveMembership } from '@/lib/api-helpers'
import Stripe from 'stripe'
import { logger } from '@/lib/logger'
import { withRateLimit } from '@/lib/rate-limit'
import { withCsrfProtection } from '@/lib/csrf'

export const runtime = 'nodejs'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
})

export const POST = withCsrfProtection(
  withRateLimit(
    async (_req: Request) => {
      try {
        const session = await auth()
        if (!session?.user?.id) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        // Get organization
        const userOrgRole = await resolveActiveMembership(session.user.id, session.user.activeOrgId)

        if (!userOrgRole) {
          return NextResponse.json({ error: 'No organization' }, { status: 400 })
        }

        // AUTH-006: only organization admins may manage billing
        if (userOrgRole.role !== 'ORG_ADMIN') {
          return NextResponse.json(
            { error: 'Only organization admins can manage billing' },
            { status: 403 },
          )
        }

        // Get customer
        const customer = await prisma.orgCustomer.findUnique({
          where: { orgId: userOrgRole.orgId },
        })

        if (!customer?.providerCustomerId) {
          return NextResponse.json({ error: 'No Stripe customer found' }, { status: 400 })
        }

        // Create portal session
        const portalSession = await stripe.billingPortal.sessions.create({
          customer: customer.providerCustomerId,
          return_url: `${process.env.NEXT_PUBLIC_APP_URL}/employer/settings`,
        })

        return NextResponse.json({
          url: portalSession.url,
        })
      } catch (error) {
        logger.error('Portal session error:', error)
        return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 })
      }
    },
    { preset: 'api' },
  ),
)
