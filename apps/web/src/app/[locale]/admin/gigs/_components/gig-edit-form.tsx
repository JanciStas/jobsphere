'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const STATUSES = ['OPEN', 'IN_PROGRESS', 'CLOSED'] as const

interface GigEditFormProps {
  gigId: string
  initial: {
    title: string
    description: string
    budget: number | null
    currency: string
    durationDays: number | null
    status: string
  }
}

const toIntOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

/** Admin edit of a gig: title, description, budget, currency, duration, status. */
export function GigEditForm({ gigId, initial }: GigEditFormProps) {
  const t = useTranslations('adminMarketplace')
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    title: initial.title,
    description: initial.description,
    budget: initial.budget?.toString() ?? '',
    currency: initial.currency,
    durationDays: initial.durationDays?.toString() ?? '',
    status: initial.status,
  })

  function set<K extends keyof typeof form>(key: K, value: string) {
    setSaved(false)
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/gigs/${gigId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          budget: toIntOrNull(form.budget),
          currency: form.currency.trim(),
          durationDays: toIntOrNull(form.durationDays),
          status: form.status,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? t('common.saveFailed'))
        return
      }
      setSaved(true)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <Label htmlFor="gig-title">{t('gigs.detail.titleField')}</Label>
        <Input
          id="gig-title"
          required
          minLength={3}
          maxLength={200}
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="gig-description">{t('gigs.detail.description')}</Label>
        <Textarea
          id="gig-description"
          required
          minLength={10}
          rows={6}
          maxLength={10000}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="gig-budget">{t('gigs.detail.budget')}</Label>
        <Input
          id="gig-budget"
          type="number"
          min={0}
          value={form.budget}
          onChange={(e) => set('budget', e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="gig-currency">{t('gigs.detail.currency')}</Label>
        <Input
          id="gig-currency"
          required
          minLength={3}
          maxLength={3}
          value={form.currency}
          onChange={(e) => set('currency', e.target.value.toUpperCase())}
        />
      </div>
      <div>
        <Label htmlFor="gig-duration">{t('gigs.detail.durationDays')}</Label>
        <Input
          id="gig-duration"
          type="number"
          min={1}
          value={form.durationDays}
          onChange={(e) => set('durationDays', e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="gig-status">{t('common.status')}</Label>
        <select
          id="gig-status"
          value={form.status}
          onChange={(e) => set('status', e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`gigStatusLabels.${s}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-3 md:col-span-2">
        <Button type="submit" disabled={loading}>
          {loading ? t('common.saving') : t('common.save')}
        </Button>
        {saved && <span className="text-sm text-green-700">{t('common.saved')}</span>}
        {error && (
          <span role="alert" className="text-sm text-destructive">
            {error}
          </span>
        )}
      </div>
    </form>
  )
}
