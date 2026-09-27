import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { withRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

/**
 * Verify Resend webhook signature using Svix headers.
 * If RESEND_WEBHOOK_SECRET is not set, rejects the request in production.
 */
function verifyResendSignature(body: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('RESEND_WEBHOOK_SECRET not set in production - rejecting webhook')
      return false
    }
    console.warn('RESEND_WEBHOOK_SECRET not set - skipping webhook signature verification')
    return true // Allow in dev
  }

  const svixId = headers.get('svix-id')
  const svixTimestamp = headers.get('svix-timestamp')
  const svixSignature = headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return false
  }

  const signedContent = `${svixId}.${svixTimestamp}.${body}`
  const secretBytes = Buffer.from(secret.split('_').pop() || secret, 'base64')
  const signature = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64')

  const expectedSignatures = svixSignature.split(' ')
  return expectedSignatures.some((sig) => {
    const sigValue = sig.split(',').pop() || sig
    return sigValue === signature
  })
}

/**
 * Verify SendGrid webhook using the x-twilio-email-event-webhook-signature header.
 * If SENDGRID_WEBHOOK_SECRET is not set, rejects the request in production.
 */
function verifySendGridSignature(body: string, headers: Headers): boolean {
  const secret = process.env.SENDGRID_WEBHOOK_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('SENDGRID_WEBHOOK_SECRET not set in production - rejecting webhook')
      return false
    }
    console.warn('SENDGRID_WEBHOOK_SECRET not set - skipping SendGrid signature verification')
    return true // Allow in dev
  }

  const signature = headers.get('x-twilio-email-event-webhook-signature')
  if (!signature) {
    return false
  }

  const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('base64')
  return signature === expectedSig
}

// Rate-limit the public webhook (defense-in-depth on top of signature verification).
export const POST = withRateLimit(
  async (req: NextRequest) => {
    try {
      // Read raw body for signature verification before parsing JSON
      const rawBody = await req.text()

      // Verify Resend webhook signature (Svix headers)
      if (!verifyResendSignature(rawBody, req.headers)) {
        logger.warn('Email webhook signature verification failed')
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }

      const body = JSON.parse(rawBody)

      // Resend webhook format
      if (body.type) {
        return handleResendWebhook(body)
      }

      // SendGrid webhook format
      if (Array.isArray(body)) {
        if (!verifySendGridSignature(rawBody, req.headers)) {
          logger.warn('SendGrid webhook signature verification failed')
          return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
        }
        return handleSendGridWebhook(body)
      }

      return NextResponse.json({ error: 'Unknown webhook format' }, { status: 400 })
    } catch (error) {
      logger.error('Email webhook error:', error)
      return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
  },
  { limit: 1000, window: 60 },
)

async function handleResendWebhook(event: any) {
  const { type, data } = event

  const kindMap: Record<string, string> = {
    'email.delivered': 'SENT',
    'email.opened': 'OPENED',
    'email.clicked': 'CLICKED',
    'email.bounced': 'BOUNCED',
    'email.complained': 'COMPLAINED',
  }

  const kind = kindMap[type]
  if (!kind) return NextResponse.json({ received: true })

  const emailId = data.headers?.['X-Email-ID'] || data.tags?.emailId

  if (emailId) {
    // An event row implies its run exists (FK), so there is no separate run lookup.
    const lastEvent = await prisma.emailSequenceEvent.findFirst({
      where: { runId: emailId },
      orderBy: { at: 'desc' },
      select: { stepId: true },
    })

    if (lastEvent) {
      await prisma.emailSequenceEvent.create({
        data: { runId: emailId, stepId: lastEvent.stepId, kind, metadata: data },
      })
    }
  }

  return NextResponse.json({ received: true })
}

async function handleSendGridWebhook(events: any[]) {
  // SendGrid batches 100+ events per request. This used to run three queries per
  // event in a loop; now it is one lookup for the latest step of every run plus
  // one bulk insert.
  const pending = events
    .map((event) => ({
      event,
      kind: event.event?.toUpperCase() as string | undefined,
      runId: (event.emailId || event['X-Email-ID']) as string | undefined,
    }))
    .filter((e): e is { event: any; kind: string; runId: string } => Boolean(e.runId && e.kind))

  if (pending.length > 0) {
    const runIds = [...new Set(pending.map((e) => e.runId))]
    const latest = await prisma.emailSequenceEvent.findMany({
      where: { runId: { in: runIds } },
      orderBy: [{ runId: 'asc' }, { at: 'desc' }],
      distinct: ['runId'],
      select: { runId: true, stepId: true },
    })
    const stepByRun = new Map(latest.map((row) => [row.runId, row.stepId]))

    const data = pending
      .filter((e) => stepByRun.has(e.runId))
      .map((e) => ({
        runId: e.runId,
        stepId: stepByRun.get(e.runId) as string,
        kind: e.kind,
        metadata: e.event,
      }))

    if (data.length > 0) {
      await prisma.emailSequenceEvent.createMany({ data })
    }
  }

  return NextResponse.json({ received: true })
}
