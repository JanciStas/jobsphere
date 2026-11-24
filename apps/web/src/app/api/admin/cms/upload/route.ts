/**
 * Image upload for CMS content (static pages, FAQ, blog covers and inline images).
 * Global admins only. Returns { url } of a public Vercel Blob.
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { requireAdminApi } from '@/lib/admin-guard'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'
import { createAuditLog, getRequestMetadata } from '@/lib/audit-log'
import { storeCmsImage } from '@/lib/cms/image-upload'

export const POST = withCsrfProtection(
  withRateLimit(
    async (request: Request) => {
      const guard = await requireAdminApi()
      if (!guard.ok) return guard.response
      try {
        const form = await request.formData().catch(() => null)
        if (!form) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
        const result = await storeCmsImage(form.get('file'), 'cms')
        if (!result.ok) {
          return NextResponse.json(
            { error: result.error, code: result.code },
            { status: result.status },
          )
        }
        await createAuditLog({
          userId: guard.session.user.id,
          action: 'CREATE',
          resource: 'CMS_UPLOAD',
          metadata: { url: result.url },
          ...getRequestMetadata(request),
        })
        return NextResponse.json({ url: result.url })
      } catch (error) {
        logger.error('CMS image upload failed', { error })
        return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
      }
    },
    { preset: 'upload', byUser: true },
  ),
)
