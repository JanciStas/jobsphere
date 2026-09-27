'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface NotificationRow {
  id: string
  type: string
  title: string
  body: string
  readAt: string | null
  createdAt: string
  data?: Record<string, unknown> | null
}

/**
 * The read side of notifications, in the header.
 *
 * Without this the `Notification` model would have gone from dead to
 * write-only — rows accumulating that nobody can see, which is the same failure
 * one layer up.
 *
 * Polls rather than streams: the alternative is a websocket or SSE for something
 * whose worst case is finding out about an application a minute late.
 */
const POLL_MS = 60_000

export function NotificationBell({ locale }: { locale: string }) {
  const t = useTranslations('notifications')
  const [items, setItems] = useState<NotificationRow[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const data = await res.json()
      setItems(data.notifications ?? [])
      setUnread(data.unreadCount ?? 0)
    } catch {
      // A failed poll is not worth surfacing; the next one is a minute away.
    }
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  const markAllRead = async () => {
    // Optimistic: the badge should go the moment it is clicked, and a failed
    // PATCH only means it comes back on the next poll.
    setUnread(0)
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })))
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => load())
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        aria-label={unread > 0 ? t('labelUnread', { count: unread }) : t('label')}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>

      {open && (
        <>
          {/* Click-away layer. A dropdown that only closes via its own trigger is
              a dropdown people leave open by accident. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-50 mt-2 w-80 rounded-lg border bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium">{t('label')}</span>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  {t('markAllRead')}
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
              ) : (
                items.map((item) => {
                  const applicationId = item.data?.applicationId as string | undefined
                  const inner = (
                    <>
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.body}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {item.createdAt.slice(0, 16).replace('T', ' ')}
                      </p>
                    </>
                  )
                  const className = `block border-b px-3 py-2 last:border-0 ${
                    item.readAt ? '' : 'bg-muted/40'
                  }`

                  return applicationId ? (
                    <Link
                      key={item.id}
                      href={`/${locale}/employer/applicants/${applicationId}`}
                      className={`${className} hover:bg-muted`}
                      onClick={() => setOpen(false)}
                    >
                      {inner}
                    </Link>
                  ) : (
                    <div key={item.id} className={className}>
                      {inner}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
