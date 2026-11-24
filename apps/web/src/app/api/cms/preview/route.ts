/**
 * Markdown preview for CMS editors (super admin content + employer career page).
 * Any signed-in user; returns the exact sanitized HTML the public page will render.
 */

export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { withCsrfProtection } from '@/lib/csrf'
import { withRateLimit } from '@/lib/rate-limit'
import { MAX_MARKDOWN_LENGTH, renderMarkdown } from '@/lib/cms/markdown'

const bodySchema = z.object({ markdown: z.string().max(MAX_MARKDOWN_LENGTH) })

export const POST = withCsrfProtection(
  withRateLimit(
    async (request: Request) => {
      const session = await auth()
      if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      const json = await request.json().catch(() => null)
      const parsed = bodySchema.safeParse(json)
      if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
      return NextResponse.json({ html: renderMarkdown(parsed.data.markdown) })
    },
    { preset: 'api', byUser: true },
  ),
)
