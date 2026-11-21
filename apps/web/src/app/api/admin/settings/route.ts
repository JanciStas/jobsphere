import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { handleApiError } from '@/lib/errors'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'

async function requireGlobalAdmin() {
  const session = await auth()
  if (!session?.user?.isGlobalAdmin) {
    return null
  }
  return session
}

async function getSettings() {
  try {
    const session = await requireGlobalAdmin()
    if (!session) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Both tables are global config with a handful of rows; `take` is a safety net
    // against an unbounded scan, not a paging feature (ordering is already
    // deterministic on the unique `key`).
    const [settings, flags] = await Promise.all([
      prisma.systemSetting.findMany({ orderBy: { key: 'asc' }, take: 500 }),
      prisma.featureFlag.findMany({ orderBy: { key: 'asc' }, take: 500 }),
    ])

    return NextResponse.json({ settings, flags })
  } catch (error) {
    logger.error('Admin GET /settings error:', error)
    return handleApiError(error)
  }
}

const patchSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('setting'),
    key: z.string().min(1),
    value: z.string(),
  }),
  z.object({
    type: z.literal('flag'),
    key: z.string().min(1),
    value: z.boolean(),
  }),
])

export const PATCH = withCsrfProtection(
  withRateLimit(
    async (req: Request) => {
      try {
        const session = await requireGlobalAdmin()
        if (!session) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }

        const body = await req.json().catch(() => null)
        const parsed = patchSchema.parse(body)

        if (parsed.type === 'setting') {
          const result = await prisma.systemSetting.upsert({
            where: { key: parsed.key },
            update: { value: parsed.value },
            create: { key: parsed.key, value: parsed.value },
          })
          logger.info(`Admin upsert setting ${parsed.key} by ${session.user.id}`)

          await createAuditLog({
            userId: session.user.id,
            action: 'UPDATE',
            resource: 'SETTING',
            resourceId: parsed.key,
            metadata: { value: parsed.value },
            ...getRequestMetadata(req),
          })
          return NextResponse.json({ setting: result })
        }

        const flag = await prisma.featureFlag.findUnique({ where: { key: parsed.key } })
        if (!flag) {
          return NextResponse.json({ error: 'Feature flag not found' }, { status: 404 })
        }

        const result = await prisma.featureFlag.update({
          where: { key: parsed.key },
          data: { enabled: parsed.value },
        })
        logger.info(`Admin toggle flag ${parsed.key}=${parsed.value} by ${session.user.id}`)

        await createAuditLog({
          userId: session.user.id,
          action: 'UPDATE',
          resource: 'FEATURE_FLAG',
          resourceId: parsed.key,
          previous: { enabled: !parsed.value },
          metadata: { enabled: parsed.value },
          ...getRequestMetadata(req),
        })
        return NextResponse.json({ flag: result })
      } catch (error) {
        logger.error('Admin PATCH /settings error:', error)
        return handleApiError(error)
      }
    },
    { preset: 'api' },
  ),
)

// Rate limiting was missing on this handler until the route wrapper contract
// test (tests/security/route-wrapper-contract.test.ts) enumerated the API surface.
export const GET = withRateLimit(getSettings, { preset: 'api', byUser: true })
