'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Inline "send a proposal" form for a single gig. Posts to the gig proposals API.
 * Auth + freelancer-profile checks happen server-side; we surface the API's message.
 */
export function GigProposalForm({ gigId, currency }: { gigId: string; currency: string }) {
  const t = useTranslations('miscGigProposal')
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ proposedRate: '', proposedDurationDays: '', message: '' })

  const submit = async () => {
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch(`/api/gigs/${gigId}/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposedRate: form.proposedRate ? parseInt(form.proposedRate, 10) : null,
          proposedDurationDays: form.proposedDurationDays
            ? parseInt(form.proposedDurationDays, 10)
            : null,
          message: form.message.trim() || undefined,
        }),
      })
      if (res.status === 401) {
        setError(t('loginRequired'))
        return
      }
      if (res.status === 403) {
        setError(t('freelancersOnly'))
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || t('failed'))
        return
      }
      setDone(true)
    } catch {
      setError(t('failedRetry'))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return <p className="text-sm font-medium text-green-600">{t('sent')}</p>
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        {t('open')}
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/30 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`rate-${gigId}`}>{t('rate', { currency })}</Label>
          <Input
            id={`rate-${gigId}`}
            type="number"
            min={0}
            placeholder={t('ratePlaceholder')}
            value={form.proposedRate}
            onChange={(e) => setForm({ ...form, proposedRate: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`dur-${gigId}`}>{t('duration')}</Label>
          <Input
            id={`dur-${gigId}`}
            type="number"
            min={1}
            placeholder={t('durationPlaceholder')}
            value={form.proposedDurationDays}
            onChange={(e) => setForm({ ...form, proposedDurationDays: e.target.value })}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`msg-${gigId}`}>{t('message')}</Label>
        <textarea
          id={`msg-${gigId}`}
          className="min-h-[80px] w-full rounded-md border px-3 py-2 text-sm"
          placeholder={t('messagePlaceholder')}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={submitting}>
          {submitting ? t('submitting') : t('submit')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  )
}
