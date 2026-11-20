'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

const AVAILABILITIES = ['AVAILABLE', 'LIMITED', 'UNAVAILABLE'] as const

interface FreelancerEditFormProps {
  freelancerId: string
  initial: {
    title: string
    bio: string
    services: string[]
    skills: string[]
    hourlyRate: number | null
    availability: string
    location: string
    portfolioUrl: string
    visible: boolean
  }
}

const toList = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/** Admin edit of a freelancer profile, including hide/show (visible). */
export function FreelancerEditForm({ freelancerId, initial }: FreelancerEditFormProps) {
  const t = useTranslations('adminMarketplace')
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState({
    title: initial.title,
    bio: initial.bio,
    services: initial.services.join(', '),
    skills: initial.skills.join(', '),
    hourlyRate: initial.hourlyRate?.toString() ?? '',
    availability: initial.availability,
    location: initial.location,
    portfolioUrl: initial.portfolioUrl,
    visible: initial.visible,
  })

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setSaved(false)
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const rate = form.hourlyRate.trim()
      const res = await fetch(`/api/admin/freelancers/${freelancerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim() || null,
          bio: form.bio.trim() || null,
          services: toList(form.services),
          skills: toList(form.skills),
          hourlyRate: rate === '' ? null : Number(rate),
          availability: form.availability,
          location: form.location.trim() || null,
          portfolioUrl: form.portfolioUrl.trim() || null,
          visible: form.visible,
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
      <div className="flex items-center gap-3 md:col-span-2">
        <Switch id="fl-visible" checked={form.visible} onCheckedChange={(v) => set('visible', v)} />
        <div>
          <Label htmlFor="fl-visible">{t('freelancers.detail.visibleField')}</Label>
          <p className="text-xs text-muted-foreground">{t('freelancers.detail.visibleHint')}</p>
        </div>
      </div>
      <div>
        <Label htmlFor="fl-title">{t('freelancers.detail.titleField')}</Label>
        <Input
          id="fl-title"
          maxLength={120}
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="fl-location">{t('freelancers.detail.location')}</Label>
        <Input
          id="fl-location"
          maxLength={120}
          value={form.location}
          onChange={(e) => set('location', e.target.value)}
        />
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="fl-bio">{t('freelancers.detail.bio')}</Label>
        <Textarea
          id="fl-bio"
          rows={5}
          maxLength={5000}
          value={form.bio}
          onChange={(e) => set('bio', e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="fl-services">{t('freelancers.detail.services')}</Label>
        <Input
          id="fl-services"
          value={form.services}
          onChange={(e) => set('services', e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t('freelancers.detail.listHint')}</p>
      </div>
      <div>
        <Label htmlFor="fl-skills">{t('freelancers.detail.skills')}</Label>
        <Input id="fl-skills" value={form.skills} onChange={(e) => set('skills', e.target.value)} />
        <p className="mt-1 text-xs text-muted-foreground">{t('freelancers.detail.listHint')}</p>
      </div>
      <div>
        <Label htmlFor="fl-rate">{t('freelancers.detail.hourlyRate')}</Label>
        <Input
          id="fl-rate"
          type="number"
          min={0}
          value={form.hourlyRate}
          onChange={(e) => set('hourlyRate', e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="fl-availability">{t('freelancers.availability')}</Label>
        <select
          id="fl-availability"
          value={form.availability}
          onChange={(e) => set('availability', e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {AVAILABILITIES.map((a) => (
            <option key={a} value={a}>
              {t(`availabilityLabels.${a}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="md:col-span-2">
        <Label htmlFor="fl-url">{t('freelancers.detail.portfolioUrl')}</Label>
        <Input
          id="fl-url"
          type="url"
          placeholder="https://…"
          value={form.portfolioUrl}
          onChange={(e) => set('portfolioUrl', e.target.value)}
        />
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
