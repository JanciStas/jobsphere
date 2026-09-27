/**
 * Stripe Webhook Handler
 * Spracúva Stripe events (subscription.created, payment.succeeded, etc.)
 */

import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import Stripe from 'stripe'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { withRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
})

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

export const POST = withRateLimit(
  async (request: NextRequest) => {
    let eventId: string | undefined

    try {
      const body = await request.text()
      const signature = (await headers()).get('stripe-signature')

      if (!signature) {
        return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
      }

      let event: Stripe.Event

      try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
      } catch (err) {
        logger.error('Webhook signature verification failed', err)
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
      }

      eventId = event.id
      logger.info(`Stripe webhook received: ${event.type}`, { eventId: event.id })

      // Idempotency, step 1 — record the event (idempotent insert). The unique
      // primary key guarantees one row per Stripe event id regardless of how
      // many concurrent retries arrive.
      try {
        await prisma.providerEvent.upsert({
          where: { id: event.id },
          update: {},
          create: {
            id: event.id,
            provider: 'stripe',
            kind: event.type,
            payload: JSON.parse(JSON.stringify(event.data.object)),
            processed: false,
          },
        })
      } catch (e) {
        // Handle race condition: concurrent upsert may still hit P2002
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          logger.warn('Concurrent Stripe webhook duplicate detected', { eventId: event.id })
          return NextResponse.json({ received: true, duplicate: true })
        }
        throw e
      }

      // Idempotency, step 2 — atomically CLAIM the event. Flipping processed
      // false->true in a single conditional updateMany means exactly one of N
      // concurrent deliveries gets count === 1; everyone else sees count === 0
      // and bails. This closes the check-then-act race (LOGIC-015). On handler
      // failure we reset processed=false below so Stripe retries can re-claim.
      const claim = await prisma.providerEvent.updateMany({
        where: { id: event.id, processed: false },
        data: { processed: true },
      })

      if (claim.count === 0) {
        logger.warn('Duplicate Stripe webhook event skipped', {
          eventId: event.id,
          type: event.type,
        })
        return NextResponse.json({ received: true, duplicate: true })
      }

      // Handle events with proper type safety
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session
          await handleCheckoutCompleted(session)
          break
        }

        case 'customer.subscription.created':
        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription
          await handleSubscriptionUpdate(subscription)
          break
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription
          await handleSubscriptionDeleted(subscription)
          break
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as Stripe.Invoice
          await handlePaymentSucceeded(invoice)
          break
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice
          await handlePaymentFailed(invoice)
          break
        }

        default:
          logger.warn(`Unhandled Stripe event type: ${event.type}`, { eventId: event.id })
      }

      // The event was claimed (processed=true) before the handler ran, so a
      // successful run needs no further write.
      return NextResponse.json({ received: true })
    } catch (error) {
      logger.error('Webhook error', error)

      // Release the claim and record the error so Stripe's retry can re-process.
      if (eventId) {
        try {
          await prisma.providerEvent.updateMany({
            where: { id: eventId, provider: 'stripe' },
            data: { processed: false, error: String(error) },
          })
        } catch {
          // Ignore errors in error recording - don't mask the original error
        }
      }

      return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
    }
  },
  { limit: 1000, window: 60 }, // High limit for webhooks - 1000 per minute
)

/**
 * Handle checkout session completed
 */
export async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const organizationId = session.metadata?.organizationId

  if (!organizationId) {
    logger.error('No organizationId in checkout session metadata')
    return
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true },
  })
  if (!org) {
    logger.error('Stripe checkout: unknown organizationId in metadata', {
      organizationId,
      sessionId: session.id,
    })
    return
  }

  // Create or update customer
  await prisma.orgCustomer.upsert({
    where: { orgId: organizationId },
    create: {
      orgId: organizationId,
      providerCustomerId: session.customer as string,
    },
    update: {
      providerCustomerId: session.customer as string,
    },
  })

  logger.info('Stripe checkout completed', { organizationId, sessionId: session.id })
}

/**
 * Map a Stripe subscription status to our canonical lowercase status string.
 * The Subscription.status column stores Stripe's own vocabulary 1:1
 * (trialing, active, past_due, canceled, unpaid, incomplete, ...).
 */
function mapStripeStatus(status: Stripe.Subscription.Status): string {
  return status
}

/**
 * Resolve the local Product + plan key for a Stripe subscription.
 *
 * Mapping strategy (DB-driven, not env/string parsing):
 *   Stripe price id  ->  Price.providerPriceId (unique)  ->  Price.productId  ->  Product
 *   Product.plans[0].key  ->  plan key (starter/pro/enterprise)
 *
 * ASSUMPTION: The local catalog is seeded so that every Stripe price has a
 * matching Price row (providerPriceId) and the owning Product has a Plan whose
 * `key` is one of starter/pro/professional/enterprise. There is no Stripe-id
 * field on Product itself, so the price row is the only reliable join.
 */
async function resolvePlanFromSubscription(subscription: Stripe.Subscription): Promise<{
  productId: string
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE'
} | null> {
  const priceId = subscription.items.data[0]?.price.id

  if (!priceId) {
    logger.error('No price ID in subscription', { subscriptionId: subscription.id })
    return null
  }

  const price = await prisma.price.findFirst({
    where: { providerPriceId: priceId },
    include: {
      product: {
        include: { plans: true },
      },
    },
  })

  if (!price) {
    logger.error('No local Price found for Stripe price ID', { priceId })
    return null
  }

  return {
    productId: price.productId,
    plan: derivePlanKey(price.product),
  }
}

/**
 * Derive a normalized plan key from the local Product (plan relation first,
 * then product name as a fallback). Mirrors getCurrentPlan() in entitlements.ts.
 */
function derivePlanKey(product: {
  name: string
  plans: { key: string }[]
}): 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE' {
  const planKey = product.plans[0]?.key?.toUpperCase()
  if (planKey === 'ENTERPRISE') return 'ENTERPRISE'
  if (planKey === 'PROFESSIONAL' || planKey === 'PRO') return 'PROFESSIONAL'
  if (planKey === 'STARTER') return 'STARTER'

  const name = product.name.toLowerCase()
  if (name.includes('enterprise')) return 'ENTERPRISE'
  if (name.includes('professional') || name.includes('pro')) return 'PROFESSIONAL'

  return 'STARTER'
}

/**
 * Handle subscription created/updated
 */
async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string

  // Find organization by customer ID
  const customer = await prisma.orgCustomer.findUnique({
    where: { providerCustomerId: customerId },
  })

  if (!customer) {
    logger.error('Customer not found', { customerId })
    return
  }

  // Map the Stripe price/product to a local Product + plan key via DB.
  const resolved = await resolvePlanFromSubscription(subscription)

  if (!resolved) {
    // Missing catalog mapping — surface so Stripe retries rather than silently
    // leaving the customer without a plan.
    throw new Error(`No local Product mapping for Stripe subscription ${subscription.id}`)
  }

  const { productId, plan } = resolved

  // Build a payload containing ONLY real Subscription columns. The plan key is
  // persisted in metadata (there is no `plan` column) so getCurrentPlan() can
  // read it back via Strategy 2.
  const data = {
    orgId: customer.orgId,
    productId,
    status: mapStripeStatus(subscription.status),
    currentPeriodStart: new Date(subscription.current_period_start * 1000),
    currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    cancelAt: subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : null,
    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
    trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
    trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
    metadata: { planKey: plan, cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false },
  }

  // Key on the unique providerSubId so create/update target the SAME row and
  // out-of-order/concurrent deliveries converge instead of clobbering siblings.
  await prisma.subscription.upsert({
    where: { providerSubId: subscription.id },
    create: { providerSubId: subscription.id, ...data },
    update: data,
  })

  // Update entitlements based on the DB-resolved plan.
  await updateEntitlements(customer.orgId, plan)

  logger.info('Stripe subscription updated', {
    organizationId: customer.orgId,
    subscriptionId: subscription.id,
    status: subscription.status,
    plan,
  })
}

/**
 * Handle subscription deleted
 */
async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string

  const customer = await prisma.orgCustomer.findUnique({
    where: { providerCustomerId: customerId },
  })

  if (!customer) return

  // Cancel only the specific subscription (keyed on providerSubId), never every
  // subscription of the org — an upgrade deletes the old sub while the new one
  // must stay active.
  const now = new Date()
  await prisma.subscription.updateMany({
    where: { providerSubId: subscription.id },
    data: {
      status: mapStripeStatus(subscription.status), // 'canceled'
      canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : now,
      endedAt: subscription.ended_at ? new Date(subscription.ended_at * 1000) : now,
    },
  })

  // Revert to free plan entitlements.
  await updateEntitlements(customer.orgId, 'STARTER')

  logger.info('Stripe subscription canceled', {
    organizationId: customer.orgId,
    subscriptionId: subscription.id,
  })
}

/**
 * Handle successful payment
 */
async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
  logger.info('Stripe payment succeeded', {
    invoiceId: invoice.id,
    customerId: invoice.customer,
    amount: invoice.amount_paid,
  })

  try {
    // Get customer details
    const customer = await prisma.orgCustomer.findUnique({
      where: { providerCustomerId: invoice.customer as string },
    })

    if (!customer) return

    // Get organization admin
    const orgMember = await prisma.userOrgRole.findFirst({
      where: {
        orgId: customer.orgId,
        role: 'ORG_ADMIN',
      },
      include: {
        user: true,
      },
    })

    if (orgMember?.user?.email) {
      const { sendEmail } = await import('@/lib/email')
      const adminEmail = orgMember.user.email
      const adminName = orgMember.user.name || 'there'
      const amount = (invoice.amount_paid / 100).toFixed(2)
      const currency = invoice.currency?.toUpperCase() || 'USD'

      await sendEmail({
        to: adminEmail,
        subject: `Payment Receipt - JobSphere`,
        html: `
          <h2>Payment Successful</h2>
          <p>Hi ${adminName},</p>
          <p>Thank you for your payment! Your subscription has been renewed.</p>
          <p><strong>Amount Paid:</strong> ${amount} ${currency}</p>
          <p><strong>Invoice Number:</strong> ${invoice.number || invoice.id}</p>
          <p>Your subscription is now active and all features are available.</p>
          <hr />
          <p style="color: #666; font-size: 12px;">JobSphere ATS - Modern recruitment platform</p>
        `,
      })
    }
  } catch (error) {
    logger.error('Failed to send payment receipt', error)
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice: Stripe.Invoice) {
  logger.warn('Stripe payment failed', {
    invoiceId: invoice.id,
    customerId: invoice.customer,
    attemptCount: invoice.attempt_count,
  })

  try {
    // Get customer details
    const customer = await prisma.orgCustomer.findUnique({
      where: { providerCustomerId: invoice.customer as string },
    })

    if (!customer) return

    // Get organization admin
    const orgMember = await prisma.userOrgRole.findFirst({
      where: {
        orgId: customer.orgId,
        role: 'ORG_ADMIN',
      },
      include: {
        user: true,
      },
    })

    const adminEmail = orgMember?.user?.email
    const adminName = orgMember?.user?.name || 'there'

    // Implement grace period: 7 days after first failed payment
    const gracePeriodEnd = new Date()
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 7)

    // Update subscription to past_due if first failure
    const subscription = await prisma.subscription.findFirst({
      where: {
        orgId: customer.orgId,
        status: 'active',
      },
    })

    if (subscription) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'past_due' },
      })
    }

    // Send payment failure notification
    if (adminEmail) {
      const { sendEmail } = await import('@/lib/email')
      const updatePaymentUrl = `${process.env.NEXT_PUBLIC_APP_URL}/employer/billing`

      await sendEmail({
        to: adminEmail,
        subject: `Payment Failed - Action Required`,
        html: `
          <h2>Payment Failed</h2>
          <p>Hi ${adminName},</p>
          <p>We were unable to process your recent payment for JobSphere.</p>
          <p><strong>What you need to do:</strong></p>
          <ul>
            <li>Update your payment method</li>
            <li>Ensure sufficient funds are available</li>
            <li>Check with your bank if the payment was declined</li>
          </ul>
          <p>You have until <strong>${gracePeriodEnd.toLocaleDateString()}</strong> to update your payment before your account is suspended.</p>
          <p><a href="${updatePaymentUrl}" style="display: inline-block; padding: 12px 24px; background-color: #dc2626; color: white; text-decoration: none; border-radius: 5px;">Update Payment Method</a></p>
          <hr />
          <p style="color: #666; font-size: 12px;">JobSphere ATS - Modern recruitment platform</p>
        `,
      })
    }
  } catch (error) {
    logger.error('Failed to handle payment failure', error)
  }
}

/**
 * Update organization entitlements based on plan
 */
async function updateEntitlements(
  organizationId: string,
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE',
) {
  // Define limits per plan
  const limits = {
    STARTER: {
      maxJobs: 5,
      maxCandidates: 50,
      maxTeamMembers: 2,
      emailSequences: false,
      assessments: false,
      aiMatching: false,
    },
    PROFESSIONAL: {
      maxJobs: 50,
      maxCandidates: 500,
      maxTeamMembers: 10,
      emailSequences: true,
      assessments: true,
      aiMatching: true,
    },
    ENTERPRISE: {
      maxJobs: -1, // unlimited
      maxCandidates: -1,
      maxTeamMembers: -1,
      emailSequences: true,
      assessments: true,
      aiMatching: true,
    },
  }

  const planLimits = limits[plan]

  // Upsert entitlements
  // On update: only change the limit, preserving the current remaining counter.
  // If the new limit is lower than the current remaining, cap remaining at the new limit.
  const maxJobsLimit = planLimits.maxJobs === -1 ? null : planLimits.maxJobs

  const existingJobsEntitlement = await prisma.entitlement.findUnique({
    where: { orgId_featureKey: { orgId: organizationId, featureKey: 'MAX_JOBS' } },
  })

  const newJobsRemaining =
    maxJobsLimit === null
      ? null
      : existingJobsEntitlement?.remainingInt !== undefined &&
          existingJobsEntitlement.remainingInt !== null
        ? Math.min(existingJobsEntitlement.remainingInt, maxJobsLimit)
        : maxJobsLimit

  await prisma.entitlement.upsert({
    where: {
      orgId_featureKey: {
        orgId: organizationId,
        featureKey: 'MAX_JOBS',
      },
    },
    create: {
      orgId: organizationId,
      featureKey: 'MAX_JOBS',
      limitInt: maxJobsLimit,
      remainingInt: maxJobsLimit,
    },
    update: {
      limitInt: maxJobsLimit,
      remainingInt: newJobsRemaining,
    },
  })

  const maxCandidatesLimit = planLimits.maxCandidates === -1 ? null : planLimits.maxCandidates

  const existingCandidatesEntitlement = await prisma.entitlement.findUnique({
    where: { orgId_featureKey: { orgId: organizationId, featureKey: 'MAX_CANDIDATES' } },
  })

  const newCandidatesRemaining =
    maxCandidatesLimit === null
      ? null
      : existingCandidatesEntitlement?.remainingInt !== undefined &&
          existingCandidatesEntitlement.remainingInt !== null
        ? Math.min(existingCandidatesEntitlement.remainingInt, maxCandidatesLimit)
        : maxCandidatesLimit

  await prisma.entitlement.upsert({
    where: {
      orgId_featureKey: {
        orgId: organizationId,
        featureKey: 'MAX_CANDIDATES',
      },
    },
    create: {
      orgId: organizationId,
      featureKey: 'MAX_CANDIDATES',
      limitInt: maxCandidatesLimit,
      remainingInt: maxCandidatesLimit,
    },
    update: {
      limitInt: maxCandidatesLimit,
      remainingInt: newCandidatesRemaining,
    },
  })

  await prisma.entitlement.upsert({
    where: {
      orgId_featureKey: {
        orgId: organizationId,
        featureKey: 'EMAIL_SEQUENCES',
      },
    },
    create: {
      orgId: organizationId,
      featureKey: 'EMAIL_SEQUENCES',
      limitInt: planLimits.emailSequences ? 1 : 0,
    },
    update: {
      limitInt: planLimits.emailSequences ? 1 : 0,
    },
  })

  await prisma.entitlement.upsert({
    where: {
      orgId_featureKey: {
        orgId: organizationId,
        featureKey: 'ASSESSMENTS',
      },
    },
    create: {
      orgId: organizationId,
      featureKey: 'ASSESSMENTS',
      limitInt: planLimits.assessments ? 1 : 0,
    },
    update: {
      limitInt: planLimits.assessments ? 1 : 0,
    },
  })

  await prisma.entitlement.upsert({
    where: {
      orgId_featureKey: {
        orgId: organizationId,
        featureKey: 'AI_MATCHING',
      },
    },
    create: {
      orgId: organizationId,
      featureKey: 'AI_MATCHING',
      limitInt: planLimits.aiMatching ? 1 : 0,
    },
    update: {
      limitInt: planLimits.aiMatching ? 1 : 0,
    },
  })
}
