'use client'

/**
 * Support actions for one account. Every action asks for confirmation and
 * calls an admin API route that audits it. Against a super admin account only
 * "sign out everywhere" is offered (the API enforces the same rule).
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { AccountStatus } from '@/lib/admin-users/roles'
import {
  Ban,
  CheckCircle,
  KeyRound,
  LogOut,
  MailCheck,
  Pencil,
  Unlock,
  Copy,
  Loader2,
} from 'lucide-react'

type ActionKey = 'verifyEmail' | 'unlock' | 'revokeSessions' | 'suspend' | 'restore'

interface HelpActionsProps {
  userId: string
  name: string | null
  email: string
  phone: string | null
  emailVerified: boolean
  status: AccountStatus
  isGlobalAdmin: boolean
  isSelf: boolean
}

interface ApiResult {
  error?: string
  delivery?: 'email' | 'link'
  resetUrl?: string
}

export function HelpActions({
  userId,
  name,
  email,
  phone,
  emailVerified,
  status,
  isGlobalAdmin,
  isSelf,
}: HelpActionsProps) {
  const t = useTranslations('adminUsers')
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<ActionKey | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetLink, setResetLink] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)
  const [form, setForm] = useState({
    name: name ?? '',
    email,
    phone: phone ?? '',
    markVerified: false,
  })

  const base = `/api/admin/users/${encodeURIComponent(userId)}`

  async function call(
    url: string,
    method: string,
    body?: unknown,
  ): Promise<ApiResult & { ok: boolean; status: number }> {
    setBusy(true)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data: ApiResult = await res.json().catch(() => ({}))
      return { ...data, ok: res.ok, status: res.status }
    } catch {
      return { ok: false, status: 0, error: 'network' }
    } finally {
      setBusy(false)
    }
  }

  function report(ok: boolean, text: string) {
    setMessage({ ok, text })
    if (ok) router.refresh()
  }

  async function runConfirmed() {
    const action = confirm
    setConfirm(null)
    if (!action) return
    const route: Record<ActionKey, [string, string, unknown?]> = {
      verifyEmail: [`${base}/verify-email`, 'POST'],
      unlock: [`${base}/unlock`, 'POST'],
      revokeSessions: [`${base}/revoke-sessions`, 'POST'],
      suspend: ['/api/admin/users', 'PATCH', { userId, action: 'ban' }],
      restore: ['/api/admin/users', 'PATCH', { userId, action: 'unban' }],
    }
    const [url, method, body] = route[action]
    const result = await call(url, method, body)
    report(
      result.ok,
      result.ok ? t(`actions.${action}.done`) : (result.error ?? t('errors.generic')),
    )
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault()
    const payload: Record<string, unknown> = {}
    if (form.name.trim() && form.name.trim() !== (name ?? '')) payload.name = form.name.trim()
    if ((form.phone.trim() || null) !== (phone || null)) payload.phone = form.phone.trim() || null
    const emailChanged = form.email.trim().toLowerCase() !== email.toLowerCase()
    if (emailChanged) {
      payload.email = form.email.trim()
      if (form.markVerified) payload.markVerified = true
    }
    if (Object.keys(payload).length === 0) {
      setEditOpen(false)
      return
    }
    const result = await call(base, 'PATCH', payload)
    if (result.status === 409) {
      setMessage({ ok: false, text: t('edit.emailTaken') })
      return
    }
    setEditOpen(false)
    report(result.ok, result.ok ? t('edit.saved') : (result.error ?? t('errors.generic')))
  }

  async function startReset(mode: 'email' | 'link') {
    const result = await call(`${base}/password-reset`, 'POST', { mode })
    if (!result.ok) {
      report(false, result.error ?? t('errors.generic'))
      setResetOpen(false)
      return
    }
    if (result.delivery === 'link' && result.resetUrl) {
      setResetLink(result.resetUrl)
      setMessage({
        ok: true,
        text: mode === 'email' ? t('reset.fallbackLink') : t('reset.linkReady'),
      })
    } else {
      setResetOpen(false)
      report(true, t('reset.emailSent'))
    }
  }

  function closeReset() {
    setResetOpen(false)
    setResetLink(null)
  }

  const canHelp = !isGlobalAdmin
  const confirmKey = confirm
  const btn = 'justify-start'

  return (
    <div className="space-y-3">
      {message && (
        <p
          role="status"
          className={`rounded-md px-3 py-2 text-sm ${
            message.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </p>
      )}

      {isGlobalAdmin && <p className="text-xs text-slate-500">{t('actions.adminProtected')}</p>}

      <div className="flex flex-col gap-2">
        {canHelp && (
          <Button
            variant="outline"
            size="sm"
            className={btn}
            disabled={busy}
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('actions.edit.label')}
          </Button>
        )}
        {canHelp && !emailVerified && (
          <Button
            variant="outline"
            size="sm"
            className={btn}
            disabled={busy}
            onClick={() => setConfirm('verifyEmail')}
          >
            <MailCheck className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('actions.verifyEmail.label')}
          </Button>
        )}
        {canHelp && status === 'LOCKED' && (
          <Button
            variant="outline"
            size="sm"
            className={btn}
            disabled={busy}
            onClick={() => setConfirm('unlock')}
          >
            <Unlock className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('actions.unlock.label')}
          </Button>
        )}
        {canHelp && (
          <Button
            variant="outline"
            size="sm"
            className={btn}
            disabled={busy}
            onClick={() => setResetOpen(true)}
          >
            <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('actions.passwordReset.label')}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className={btn}
          disabled={busy}
          onClick={() => setConfirm('revokeSessions')}
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('actions.revokeSessions.label')}
        </Button>
        {canHelp && !isSelf && status !== 'SUSPENDED' && (
          <Button
            variant="outline"
            size="sm"
            className={`${btn} border-red-200 text-red-600 hover:bg-red-50`}
            disabled={busy}
            onClick={() => setConfirm('suspend')}
          >
            <Ban className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('actions.suspend.label')}
          </Button>
        )}
        {canHelp && status === 'SUSPENDED' && (
          <Button
            variant="outline"
            size="sm"
            className={`${btn} border-emerald-200 text-emerald-600 hover:bg-emerald-50`}
            disabled={busy}
            onClick={() => setConfirm('restore')}
          >
            <CheckCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('actions.restore.label')}
          </Button>
        )}
      </div>

      {/* Confirmation for the one-click actions */}
      <AlertDialog open={confirmKey !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmKey ? t(`actions.${confirmKey}.title`) : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmKey ? t(`actions.${confirmKey}.description`, { email }) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirmed}>{t('common.confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit profile */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t('edit.title')}</DialogTitle>
              <DialogDescription>{t('edit.description')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="adm-name">{t('edit.name')}</Label>
              <Input
                id="adm-name"
                value={form.name}
                maxLength={200}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adm-email">{t('edit.email')}</Label>
              <Input
                id="adm-email"
                type="email"
                value={form.email}
                maxLength={254}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              {form.email.trim().toLowerCase() !== email.toLowerCase() && (
                <div className="space-y-1">
                  <p className="text-xs text-amber-700">{t('edit.emailWarning')}</p>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.markVerified}
                      onChange={(e) => setForm({ ...form, markVerified: e.target.checked })}
                    />
                    {t('edit.markVerified')}
                  </label>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="adm-phone">{t('edit.phone')}</Label>
              <Input
                id="adm-phone"
                value={form.phone}
                maxLength={50}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Password reset */}
      <Dialog open={resetOpen} onOpenChange={(open) => !open && closeReset()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('reset.title')}</DialogTitle>
            <DialogDescription>{t('reset.description', { email })}</DialogDescription>
          </DialogHeader>
          {resetLink ? (
            <div className="space-y-2">
              <p className="text-sm text-amber-700">{t('reset.linkWarning')}</p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={resetLink}
                  aria-label={t('reset.linkLabel')}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigator.clipboard?.writeText(resetLink).catch(() => undefined)}
                >
                  <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                  {t('reset.copy')}
                </Button>
              </div>
            </div>
          ) : (
            <DialogFooter className="gap-2 sm:justify-start">
              <Button type="button" disabled={busy} onClick={() => startReset('email')}>
                {t('reset.sendEmail')}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => startReset('link')}
              >
                {t('reset.showLink')}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
