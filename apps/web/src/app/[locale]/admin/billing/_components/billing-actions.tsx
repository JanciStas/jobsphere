'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type ActionKey = 'grant' | 'extend' | 'cancel' | 'limit'

export interface BillingActionsProps {
  orgId: string
  orgDeleted: boolean
  hasLiveSubscription: boolean
  /** Live subscription belongs to Stripe: only the Stripe dashboard can change it. */
  stripeManaged: boolean
  stripeUrl: string | null
  features: { key: string; limit: number | null }[]
}

const ENDPOINT: Record<ActionKey, string> = {
  grant: 'grant-plan',
  extend: 'extend',
  cancel: 'cancel',
  limit: 'limits',
}

function tomorrow(): string {
  return new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)
}

/**
 * Manual billing actions. Every action asks for a mandatory reason and an
 * explicit confirmation; the server re-validates everything (this is UX only).
 */
export function BillingActions(props: BillingActionsProps) {
  const { orgId, orgDeleted, hasLiveSubscription, stripeManaged, stripeUrl, features } = props
  const router = useRouter()
  const t = useTranslations('adminBilling')
  const [action, setAction] = useState<ActionKey | null>(null)
  const [reason, setReason] = useState('')
  const [plan, setPlan] = useState('PROFESSIONAL')
  const [until, setUntil] = useState('')
  const [mode, setMode] = useState<'period_end' | 'immediate'>('period_end')
  const [featureKey, setFeatureKey] = useState(features[0]?.key ?? 'MAX_JOBS')
  const [limit, setLimit] = useState('')
  const [unlimited, setUnlimited] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function open(a: ActionKey) {
    setAction(a)
    setReason('')
    setUntil('')
    setMode('period_end')
    setLimit('')
    setUnlimited(false)
    setConfirmed(false)
    setError(null)
  }

  const needsDate = action === 'grant' || action === 'extend'
  const valid =
    reason.trim().length >= 5 &&
    confirmed &&
    (!needsDate || until !== '') &&
    (action !== 'limit' || unlimited || /^\d+$/.test(limit))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!action || !valid) return
    setLoading(true)
    setError(null)
    const base = { reason: reason.trim() }
    const untilIso = until ? `${until}T23:59:59.000Z` : undefined
    const body =
      action === 'grant'
        ? { ...base, plan, until: untilIso }
        : action === 'extend'
          ? { ...base, until: untilIso }
          : action === 'cancel'
            ? { ...base, mode }
            : { ...base, featureKey, limit: unlimited ? null : Number(limit) }
    try {
      const res = await fetch(`/api/admin/billing/${orgId}/${ENDPOINT[action]}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(
          data.code === 'STRIPE_MANAGED'
            ? t('actions.stripeManagedError')
            : (data.error ?? t('actions.failed')),
        )
        return
      }
      setAction(null)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const blocked = orgDeleted
  const subActionsDisabled = blocked || !hasLiveSubscription || stripeManaged

  return (
    <div className="space-y-4">
      <div
        role="alert"
        className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
      >
        {t('actions.manualWarning')}
      </div>
      {orgDeleted && <p className="text-sm text-red-600">{t('actions.orgDeleted')}</p>}
      {stripeManaged && (
        <p className="text-sm text-slate-600">
          {t('actions.stripeManagedInfo')}{' '}
          {stripeUrl && (
            <a href={stripeUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {t('actions.openStripe')}
            </a>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={blocked || stripeManaged} onClick={() => open('grant')}>
          {t('actions.grant')}
        </Button>
        <Button variant="outline" disabled={subActionsDisabled} onClick={() => open('extend')}>
          {t('actions.extend')}
        </Button>
        <Button variant="outline" disabled={subActionsDisabled} onClick={() => open('cancel')}>
          {t('actions.cancel')}
        </Button>
        <Button variant="outline" disabled={blocked} onClick={() => open('limit')}>
          {t('actions.limit')}
        </Button>
      </div>
      <p className="text-xs text-slate-500">{t('actions.refundNote')}</p>

      <Dialog open={action !== null} onOpenChange={(o) => !o && setAction(null)}>
        <DialogContent className="sm:max-w-md">
          {action && (
            <form onSubmit={submit} className="space-y-4">
              <DialogHeader>
                <DialogTitle>{t(`actions.${action}Title`)}</DialogTitle>
                <DialogDescription>{t('actions.confirmIntro')}</DialogDescription>
              </DialogHeader>

              {action === 'grant' && (
                <div>
                  <Label htmlFor="bill-plan">{t('actions.plan')}</Label>
                  <select
                    id="bill-plan"
                    value={plan}
                    onChange={(e) => setPlan(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    <option value="PROFESSIONAL">Professional</option>
                    <option value="ENTERPRISE">Enterprise</option>
                  </select>
                </div>
              )}

              {needsDate && (
                <div>
                  <Label htmlFor="bill-until">{t('actions.until')}</Label>
                  <Input
                    id="bill-until"
                    type="date"
                    min={tomorrow()}
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                    required
                  />
                </div>
              )}

              {action === 'cancel' && (
                <div className="space-y-2">
                  {(['period_end', 'immediate'] as const).map((m) => (
                    <label key={m} className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        name="cancel-mode"
                        checked={mode === m}
                        onChange={() => setMode(m)}
                        className="mt-1"
                      />
                      <span>{t(`actions.mode.${m}`)}</span>
                    </label>
                  ))}
                </div>
              )}

              {action === 'limit' && (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="bill-feature">{t('actions.feature')}</Label>
                    <select
                      id="bill-feature"
                      value={featureKey}
                      onChange={(e) => setFeatureKey(e.target.value)}
                      className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      {features.map((f) => (
                        <option key={f.key} value={f.key}>
                          {t(`features.${f.key}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor="bill-limit">{t('actions.newLimit')}</Label>
                    <Input
                      id="bill-limit"
                      inputMode="numeric"
                      value={limit}
                      disabled={unlimited}
                      onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))}
                    />
                    <p className="mt-1 text-xs text-slate-500">{t('actions.limitHint')}</p>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={unlimited}
                      onChange={(e) => setUnlimited(e.target.checked)}
                    />
                    {t('actions.unlimited')}
                  </label>
                </div>
              )}

              <div>
                <Label htmlFor="bill-reason">{t('actions.reason')}</Label>
                <Textarea
                  id="bill-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  required
                  rows={3}
                />
                <p className="mt-1 text-xs text-slate-500">{t('actions.reasonHint')}</p>
              </div>

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1"
                />
                {t('actions.confirmCheckbox')}
              </label>

              {error && (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAction(null)}>
                  {t('actions.close')}
                </Button>
                <Button type="submit" disabled={!valid || loading}>
                  {loading ? t('actions.saving') : t('actions.confirm')}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
