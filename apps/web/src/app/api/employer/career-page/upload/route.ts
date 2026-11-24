/**
 * Image upload for the employer career page (cover image + images inside "about").
 * ORG_ADMIN of a non-suspended org only. Stored under career/<orgId>/ in Vercel Blob.
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { storeCmsImage } from '@/lib/cms/image-upload'
import { resolveCareerEmployer } from '@/lib/career/employer-context'

export const POST = withCsrfProtection(
  withRateLimit(
    async (request: Request) => {
      const resolved = await resolveCareerEmployer({ requireAdmin: true })
      if (!resolved.ok) return resolved.response
      const { orgId, userId } = resolved.ctx
      try {
        const form = await request.formData().catch(() => null)
        if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
        const result = await storeCmsImage(form.get('file'), `career/${orgId}`)
        if (!result.ok) {
          return NextResponse.json(
            { error: result.error, code: result.code },
            { status: result.status },
          )
        }
        await createAuditLog({
          userId,
          orgId,
          action: 'CREATE',
          resource: 'CMS_UPLOAD',
          metadata: { url: result.url, scope: 'career_page' },
          ...getRequestMetadata(request),
        })
        return NextResponse.json({ url: result.url })
      } catch (error) {
        logger.error('Career page image upload failed', { error })
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
      }
    },
    { preset: 'upload', byUser: true },
  ),
)
