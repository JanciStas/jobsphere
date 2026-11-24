'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { X } from 'lucide-react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import {
  ANNOUNCEMENT_MAX_VISIBLE,
  matchesAudience,
  type AnnouncementVariant,
  type AnnouncementViewer,
  type PublicAnnouncement,
} from '@/lib/cms/announcements-shared'

export const ANNOUNCEMENT_VARIANT_CLASSES: Record<AnnouncementVariant, string> = {
  info: 'border-primary/20 bg-primary/10 text-foreground',
  warning:
    'border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50',
  promo: 'border-primary bg-primary text-primary-foreground',
}

const STORAGE_PREFIX = 'jobsphere:announcement-dismissed:'

/** Keyed by id + last edit, so an edited announcement is shown again. */
export const dismissKey = (a: Pick<PublicAnnouncement, 'id' | 'version'>) =>
  `${STORAGE_PREFIX}${a.id}:${a.version}`

function readDismissed(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function writeDismissed(key: string): void {
  try {
    window.localStorage.setItem(key, '1')
  } catch {
    // Private mode / blocked storage: the dismissal lasts for this page view only.
  }
}

/**
 * Same account logic as `describeAccount` in header.tsx: an AGENCY role or an
 * organization membership makes the viewer an employer; any other signed-in user
 * is on the candidate side; no session is a guest.
 */
export function viewerFromSession(
  user: { role?: string; orgId?: string | null } | null | undefined,
): AnnouncementViewer {
  if (!user) return 'guest'
  if (user.role === 'AGENCY' || user.orgId) return 'employer'
  return 'candidate'
}

/** Anything that is not a plain site path (`/x`, not `//x` or `/\x`) leaves the site. */
const isExternal = (url: string) => !/^\/(?![/\\])/.test(url)

/**
 * Pick what to show. Before mount (SSR and hydration) only announcements that need
 * neither the session nor localStorage are shown, so server and client markup agree.
 */
export function visibleAnnouncements(
  items: readonly PublicAnnouncement[],
  state: { now: number | null; viewer: AnnouncementViewer | null; dismissed: ReadonlySet<string> },
): PublicAnnouncement[] {
  return items
    .filter((a) => {
      if (state.now === null || state.viewer === null) {
        return a.audience === 'all' && !a.dismissible
      }
      if (a.endsAt && new Date(a.endsAt).getTime() <= state.now) return false
      if (!matchesAudience(a.audience, state.viewer)) return false
      return !(a.dismissible && state.dismissed.has(dismissKey(a)))
    })
    .slice(0, ANNOUNCEMENT_MAX_VISIBLE)
}

export function AnnouncementBarClient({ items }: { items: PublicAnnouncement[] }) {
  const t = useTranslations('announcementBar')
  const { data: session, status } = useSession()
  const [now, setNow] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    setDismissed(new Set(items.map(dismissKey).filter(readDismissed)))
    setNow(Date.now())
  }, [items])

  const viewer = status === 'loading' ? null : viewerFromSession(session?.user)
  const visible = visibleAnnouncements(items, { now, viewer, dismissed })
  if (visible.length === 0) return null

  const dismiss = (a: PublicAnnouncement) => {
    const key = dismissKey(a)
    writeDismissed(key)
    setDismissed((prev) => new Set(prev).add(key))
  }

  return (
    <section role="region" aria-label={t('label')}>
      {visible.map((a) => (
        <div key={a.id} className={cn('border-b', ANNOUNCEMENT_VARIANT_CLASSES[a.variant])}>
          <div className="container flex min-h-11 items-center gap-2 py-1 text-sm">
            <p className="min-w-0 flex-1 py-1">
              {a.message}
              {a.linkUrl ? (
                <>
                  {' '}
                  <AnnouncementLink url={a.linkUrl} label={a.linkLabel ?? t('learnMore')} />
                </>
              ) : null}
            </p>
            {a.dismissible ? (
              <button
                type="button"
                onClick={() => dismiss(a)}
                aria-label={t('dismiss')}
                className="-mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  )
}

function AnnouncementLink({ url, label }: { url: string; label: string }) {
  const t = useTranslations('announcementBar')
  const className =
    'font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm'
  if (isExternal(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
        {label}
        <span className="sr-only"> ({t('opensInNewTab')})</span>
      </a>
    )
  }
  return (
    <Link href={url} className={className}>
      {label}
    </Link>
  )
}
