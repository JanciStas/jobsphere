'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const CURRENCIES = ['EUR', 'CZK', 'PLN', 'USD']

export function NewGigForm({ locale }: { locale: string }) {
  const t = useTranslations('agencyDashboard')
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    title: '',
    description: '',
    budget: '',
    currency: 'EUR',
    durationDays: '',
  })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const res = await fetch('/api/gigs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          budget: form.budget ? parseInt(form.budget, 10) : null,
          currency: form.currency,
          durationDays: form.durationDays ? parseInt(form.durationDays, 10) : null,
        }),
      })
      if (!res.ok) {
        setError(t('newGig.error'))
        return
      }
      router.push(`/${locale}/agency/gigs`)
      router.refresh()
    } catch {
      setError(t('newGig.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardContent className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="gig-title">{t('newGig.name')}</Label>
            <Input
              id="gig-title"
              required
              maxLength={150}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gig-description">{t('newGig.description')}</Label>
            <textarea
              id="gig-description"
              required
              maxLength={8000}
              className="min-h-[160px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="gig-budget">{t('newGig.budget')}</Label>
              <Input
                id="gig-budget"
                type="number"
                min={0}
                value={form.budget}
                onChange={(e) => setForm({ ...form, budget: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gig-currency">{t('newGig.currency')}</Label>
              <select
                id="gig-currency"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gig-duration">{t('newGig.duration')}</Label>
              <Input
                id="gig-duration"
                type="number"
                min={1}
                max={3650}
                value={form.durationDays}
                onChange={(e) => setForm({ ...form, durationDays: e.target.value })}
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? t('newGig.submitting') : t('newGig.submit')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
