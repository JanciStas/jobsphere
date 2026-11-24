'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  ANNOUNCEMENT_TIME_ZONE,
  announcementStatus,
  resolveLocalized,
  type AnnouncementStatus,
} from '@/lib/cms/announcements-shared'
import type { AdminAnnouncement, AnnouncementsLoadState } from './admin-announcement'

const STATUS_CLASSES: Record<AnnouncementStatus, string> = {
  active:
    'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
  scheduled:
    'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100',
  expired: 'border-border bg-muted text-muted-foreground',
  inactive: 'border-border bg-background text-muted-foreground',
}

export function AnnouncementsList({
  locale,
  initialItems,
  loadState,
  renderedAt,
}: {
  locale: string
  initialItems: AdminAnnouncement[]
  loadState: AnnouncementsLoadState
  /** Server render time, so status chips match between server and client markup. */
  renderedAt: string
}) {
  const t = useTranslations('adminAnnouncements')
  const format = useFormatter()
  const router = useRouter()
  const [items, setItems] = useState(initialItems)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AdminAnnouncement | null>(null)
  const now = useMemo(() => new Date(renderedAt), [renderedAt])

  const date = (iso: string) =>
    format.dateTime(new Date(iso), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: ANNOUNCEMENT_TIME_ZONE,
    })

  const schedule = (a: AdminAnnouncement) => {
    if (a.startsAt && a.endsAt)
      return t('schedule.range', { from: date(a.startsAt), to: date(a.endsAt) })
    if (a.startsAt) return t('schedule.from', { date: date(a.startsAt) })
    if (a.endsAt) return t('schedule.until', { date: date(a.endsAt) })
    return t('schedule.always')
  }

  const failMessage = (status: number) =>
    status === 503
      ? t('errors.notMigrated')
      : status === 404
        ? t('errors.notFound')
        : t('errors.generic')

  const toggleActive = async (a: AdminAnnouncement, active: boolean) => {
    setBusyId(a.id)
    try {
      const res = await fetch(`/api/admin/cms/announcements/${encodeURIComponent(a.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      })
      if (!res.ok) {
        toast.error(failMessage(res.status))
        return
      }
      setItems((list) => list.map((x) => (x.id === a.id ? { ...x, active } : x)))
      toast.success(active ? t('toasts.activated') : t('toasts.deactivated'))
      router.refresh()
    } catch {
      toast.error(t('errors.generic'))
    } finally {
      setBusyId(null)
    }
  }

  const confirmDelete = async () => {
    const target = pendingDelete
    if (!target) return
    setBusyId(target.id)
    try {
      const res = await fetch(`/api/admin/cms/announcements/${encodeURIComponent(target.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        toast.error(failMessage(res.status))
        return
      }
      setItems((list) => list.filter((x) => x.id !== target.id))
      toast.success(t('toasts.deleted'))
      router.refresh()
    } catch {
      toast.error(t('errors.generic'))
    } finally {
      setBusyId(null)
      setPendingDelete(null)
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="announcements-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="announcements-heading" className="text-lg font-semibold">
            {t('title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        {loadState !== 'missing' ? (
          <Button asChild>
            <Link href={`/${locale}/admin/content/announcements/new`}>
              <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('newButton')}
            </Link>
          </Button>
        ) : null}
      </div>

      {loadState !== 'ok' ? (
        <p role="alert" className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          {loadState === 'missing' ? t('errors.notMigrated') : t('errors.loadFailed')}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2">
                  {t('columns.message')}
                </th>
                <th scope="col" className="px-4 py-2">
                  {t('columns.audience')}
                </th>
                <th scope="col" className="px-4 py-2">
                  {t('columns.schedule')}
                </th>
                <th scope="col" className="px-4 py-2">
                  {t('columns.status')}
                </th>
                <th scope="col" className="px-4 py-2">
                  {t('columns.active')}
                </th>
                <th scope="col" className="px-4 py-2 text-right">
                  <span className="sr-only">{t('columns.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => {
                const status = announcementStatus(a, now)
                const text = resolveLocalized(a.message, locale) ?? '—'
                return (
                  <tr key={a.id} className="border-b align-top last:border-0">
                    <td className="max-w-md px-4 py-3">
                      <p className="line-clamp-2">{text}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t(`variants.${a.variant}`)}
                        {a.dismissible ? ` · ${t('dismissibleShort')}` : ''}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{t(`audiences.${a.audience}`)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{schedule(a)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_CLASSES[status]}`}
                      >
                        {t(`status.${status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Switch
                        checked={a.active}
                        disabled={busyId === a.id}
                        onCheckedChange={(v) => toggleActive(a, v)}
                        aria-label={t('actions.toggleActive', { message: text.slice(0, 60) })}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link
                          href={`/${locale}/admin/content/announcements/${encodeURIComponent(a.id)}`}
                        >
                          <Pencil className="mr-1 h-4 w-4" aria-hidden="true" />
                          {t('actions.edit')}
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={busyId === a.id}
                        onClick={() => setPendingDelete(a)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                        {t('actions.delete')}
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteDialog.description', {
                message: pendingDelete
                  ? (resolveLocalized(pendingDelete.message, locale) ?? '').slice(0, 120)
                  : '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>
              {t('deleteDialog.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId !== null}
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('deleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
