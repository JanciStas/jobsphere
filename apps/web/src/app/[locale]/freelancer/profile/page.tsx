'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, ExternalLink } from 'lucide-react'

type Availability = 'AVAILABLE' | 'LIMITED' | 'UNAVAILABLE'

interface ProfileForm {
  title: string
  bio: string
  services: string // one per line
  skills: string // one per line
  hourlyRate: string
  availability: Availability
  location: string
  portfolioUrl: string
  visible: boolean
}

const EMPTY: ProfileForm = {
  title: '',
  bio: '',
  services: '',
  skills: '',
  hourlyRate: '',
  availability: 'AVAILABLE',
  location: '',
  portfolioUrl: '',
  visible: true,
}

const linesToArray = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

export default function FreelancerProfilePage() {
  const t = useTranslations('freelancerDashboard.profile')
  const locale = useLocale()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [profileId, setProfileId] = useState<string | null>(null)
  const [form, setForm] = useState<ProfileForm>(EMPTY)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/freelancer/profile')
        if (!res.ok) throw new Error('load failed')
        const { profile } = await res.json()
        if (profile) {
          setProfileId(profile.id)
          setForm({
            title: profile.title ?? '',
            bio: profile.bio ?? '',
            services: (profile.services ?? []).join('\n'),
            skills: (profile.skills ?? []).join('\n'),
            hourlyRate: profile.hourlyRate != null ? String(profile.hourlyRate) : '',
            availability: (profile.availability as Availability) ?? 'AVAILABLE',
            location: profile.location ?? '',
            portfolioUrl: profile.portfolioUrl ?? '',
            visible: profile.visible ?? true,
          })
        }
      } catch {
        setMessage(t('loadFailed'))
      } finally {
        setLoading(false)
      }
    })()
  }, [t])

  const save = async () => {
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/freelancer/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim() || undefined,
          bio: form.bio.trim() || undefined,
          services: linesToArray(form.services),
          skills: linesToArray(form.skills),
          hourlyRate: form.hourlyRate ? parseInt(form.hourlyRate, 10) : null,
          availability: form.availability,
          location: form.location.trim() || undefined,
          portfolioUrl: form.portfolioUrl.trim(),
          visible: form.visible,
        }),
      })
      if (!res.ok) throw new Error('save failed')
      const { profile } = await res.json()
      if (profile?.id) setProfileId(profile.id)
      setMessage(t('saved'))
    } catch {
      setMessage(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        {profileId && (
          <Button variant="outline" asChild>
            <Link href={`/${locale}/freelancers/${profileId}`}>
              {t('viewPublicPage')} <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('cardTitle')}</CardTitle>
          <CardDescription>{t('cardDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="title">{t('fieldTitle')}</Label>
            <Input
              id="title"
              placeholder={t('titlePh')}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">{t('bio')}</Label>
            <textarea
              id="bio"
              className="min-h-[100px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder={t('bioPh')}
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="services">{t('services')}</Label>
            <textarea
              id="services"
              className="min-h-[90px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder={t('servicesPh')}
              value={form.services}
              onChange={(e) => setForm({ ...form, services: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="skills">{t('skills')}</Label>
            <textarea
              id="skills"
              className="min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder={t('skillsPh')}
              value={form.skills}
              onChange={(e) => setForm({ ...form, skills: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="rate">{t('rate')}</Label>
              <Input
                id="rate"
                type="number"
                min={0}
                placeholder={t('ratePh')}
                value={form.hourlyRate}
                onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="availability">{t('availability')}</Label>
              <select
                id="availability"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={form.availability}
                onChange={(e) => setForm({ ...form, availability: e.target.value as Availability })}
              >
                <option value="AVAILABLE">{t('availAvailable')}</option>
                <option value="LIMITED">{t('availLimited')}</option>
                <option value="UNAVAILABLE">{t('availUnavailable')}</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">{t('location')}</Label>
              <Input
                id="location"
                placeholder={t('locationPh')}
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="portfolio">{t('portfolioUrl')}</Label>
            <Input
              id="portfolio"
              placeholder="https://…"
              value={form.portfolioUrl}
              onChange={(e) => setForm({ ...form, portfolioUrl: e.target.value })}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.visible}
              onChange={(e) => setForm({ ...form, visible: e.target.checked })}
            />
            {t('visible')}
          </label>

          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={saving}>
              {saving ? t('saving') : t('save')}
            </Button>
            {message && (
              <span role="status" className="text-sm text-muted-foreground">
                {message}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
