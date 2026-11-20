'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

export interface TeamAdmin {
  id: string
  name: string | null
  email: string
  lastLoginAt: string | null
  createdAt: string
}

type Pending = { kind: 'add'; email: string } | { kind: 'remove'; admin: TeamAdmin } | null

const ERROR_KEYS: Record<string, string> = {
  'User not found': 'errors.notFound',
  'User is already an admin': 'errors.alreadyAdmin',
  'Cannot remove the last admin': 'errors.lastAdmin',
  'You cannot remove your own admin rights': 'errors.self',
  'Invalid request': 'errors.invalidEmail',
}

export function TeamClient({
  initialAdmins,
  currentUserId,
  loadFailed,
}: {
  initialAdmins: TeamAdmin[]
  currentUserId: string
  loadFailed: boolean
}) {
  const t = useTranslations('adminCore.team')
  const format = useFormatter()
  const router = useRouter()
  const [admins, setAdmins] = useState(initialAdmins)
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)

  const fail = (message: unknown) => {
    const key = typeof message === 'string' ? ERROR_KEYS[message] : undefined
    toast.error(key ? t(key) : t('errors.generic'))
  }

  const confirm = async () => {
    if (!pending) return
    setBusy(true)
    try {
      if (pending.kind === 'add') {
        const res = await fetch('/api/admin/team', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: pending.email }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return fail(data?.error)
        setAdmins((a) => [...a, { ...data.admin, lastLoginAt: data.admin.lastLoginAt ?? null }])
        setEmail('')
        toast.success(t('added'))
      } else {
        const res = await fetch(`/api/admin/team/${encodeURIComponent(pending.admin.id)}`, {
          method: 'DELETE',
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return fail(data?.error)
        setAdmins((a) => a.filter((x) => x.id !== pending.admin.id))
        toast.success(t('removed'))
      }
      router.refresh()
    } catch {
      fail(null)
    } finally {
      setBusy(false)
      setPending(null)
    }
  }

  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' }) : t('never')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">{t('add.title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('add.hint')}</p>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            const value = email.trim().toLowerCase()
            if (value) setPending({ kind: 'add', email: value })
          }}
        >
          <div className="flex-1 space-y-2">
            <Label htmlFor="team-email">{t('add.emailLabel')}</Label>
            <Input
              id="team-email"
              type="email"
              autoComplete="off"
              placeholder={t('add.placeholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={busy}>
            {t('add.submit')}
          </Button>
        </form>
      </section>

      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold">{t('list.title', { count: admins.length })}</h2>
        {loadFailed ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('errors.generic')}</p>
        ) : admins.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">{t('colName')}</th>
                  <th className="py-2 pr-4">{t('colEmail')}</th>
                  <th className="py-2 pr-4">{t('colLastLogin')}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-medium">
                      {a.name || '—'}
                      {a.id === currentUserId && (
                        <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                          {t('you')}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4">{a.email}</td>
                    <td className="py-3 pr-4 text-muted-foreground">{date(a.lastLoginAt)}</td>
                    <td className="py-3 text-right">
                      {a.id !== currentUserId && admins.length > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => setPending({ kind: 'remove', admin: a })}
                        >
                          {t('remove')}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AlertDialog open={pending !== null} onOpenChange={(o) => !o && !busy && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('confirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === 'add'
                ? t('confirm.addBody', { email: pending.email })
                : pending?.kind === 'remove'
                  ? t('confirm.removeBody', { email: pending.admin.email })
                  : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t('confirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                void confirm()
              }}
            >
              {t('confirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
