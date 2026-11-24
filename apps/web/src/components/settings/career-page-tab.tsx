'use client'

/** Employer settings tab for the public career page (/[locale]/careers/[org.slug]). */

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Copy, ExternalLink, Info, Loader2, Lock, Save } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { MarkdownEditor } from '@/components/cms/markdown-editor'
import { BenefitsEditor } from '@/components/settings/career-page/benefits-editor'
import {
  CAREER_UPLOAD_URL,
  CoverImageField,
} from '@/components/settings/career-page/cover-image-field'
import { CAREER_LIMITS, careerPagePath, isHexColor, toVideoEmbedUrl } from '@/lib/career/media'

interface FormState {
  published: boolean
  headline: string
  subheadline: string
  about: string
  benefits: string[]
  coverImage: string
  brandColor: string
  videoUrl: string
}

interface ApiPage {
  published: boolean
  headline: string | null
  subheadline: string | null
  about: string | null
  benefits: string[]
  coverImage: string | null
  brandColor: string | null
  videoUrl: string | null
}

type LoadState =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error' }
  | { status: 'ready'; canEdit: boolean; slug: string }

const DEFAULT_COLOR = '#2563eb'

function toForm(page: ApiPage): FormState {
  return {
    published: page.published,
    headline: page.headline ?? '',
    subheadline: page.subheadline ?? '',
    about: page.about ?? '',
    benefits: page.benefits ?? [],
    coverImage: page.coverImage ?? '',
    brandColor: page.brandColor ?? '',
    videoUrl: page.videoUrl ?? '',
  }
}

export function CareerPageTab() {
  const t = useTranslations('employerCareerPage')
  const params = useParams()
  const locale = (params?.locale as string) || 'sk'

  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [form, setForm] = useState<FormState | null>(null)
  const [savedPublished, setSavedPublished] = useState(false)
  const [saving, setSaving] = useState(false)
  const [origin, setOrigin] = useState('')

  useEffect(() => {
    setOrigin(window.location.origin)
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/employer/career-page')
        if (cancelled) return
        if (res.status === 503) return setState({ status: 'unavailable' })
        if (!res.ok) return setState({ status: 'error' })
        const data = (await res.json()) as { page: ApiPage; canEdit: boolean; slug: string }
        if (cancelled) return
        setForm(toForm(data.page))
        setSavedPublished(data.page.published)
        setState({ status: 'ready', canEdit: data.canEdit, slug: data.slug })
      } catch {
        if (!cancelled) setState({ status: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const errors = useMemo(() => {
    if (!form) return {}
    return {
      brandColor: form.brandColor && !isHexColor(form.brandColor) ? t('errors.brandColor') : null,
      videoUrl:
        form.videoUrl && !toVideoEmbedUrl(form.videoUrl.trim()) ? t('errors.videoUrl') : null,
    }
  }, [form, t])
  const hasErrors = Boolean(errors.brandColor || errors.videoUrl)

  if (state.status === 'loading') {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="sr-only">{t('loading')}</span>
        </CardContent>
      </Card>
    )
  }

  if (state.status === 'unavailable' || state.status === 'error' || !form) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>
              {state.status === 'unavailable' ? t('unavailableTitle') : t('loadFailedTitle')}
            </AlertTitle>
            <AlertDescription>
              {state.status === 'unavailable' ? t('unavailable') : t('loadFailed')}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    )
  }

  const { canEdit, slug } = state
  const publicPath = careerPagePath(locale, slug)
  const publicUrl = `${origin}${publicPath}`
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      toast.success(t('publicUrl.copied'))
    } catch {
      toast.error(t('publicUrl.copyFailed'))
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form || hasErrors) return
    setSaving(true)
    try {
      const res = await fetch('/api/employer/career-page', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          benefits: form.benefits.map((b) => b.trim()).filter(Boolean),
        }),
      })
      if (res.status === 503) {
        setState({ status: 'unavailable' })
        return
      }
      if (!res.ok) {
        toast.error(res.status === 400 ? t('errors.invalid') : t('saveFailed'))
        return
      }
      const data = (await res.json()) as { page: ApiPage }
      setForm(toForm(data.page))
      setSavedPublished(data.page.published)
      toast.success(t('saved'))
    } catch {
      toast.error(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canEdit && (
            <Alert>
              <Lock className="h-4 w-4" />
              <AlertTitle>{t('readOnlyTitle')}</AlertTitle>
              <AlertDescription>{t('readOnly')}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="career-public-url">{t('publicUrl.label')}</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input id="career-public-url" value={publicUrl} readOnly className="font-mono" />
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={copyUrl}>
                  <Copy className="mr-2 h-4 w-4" />
                  {t('publicUrl.copy')}
                </Button>
                {savedPublished && (
                  <Button type="button" variant="outline" asChild>
                    <a href={publicPath} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {t('publicUrl.open')}
                    </a>
                  </Button>
                )}
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              {savedPublished ? t('publicUrl.live') : t('publicUrl.notLive')}
            </p>
          </div>
        </CardContent>
      </Card>

      <fieldset disabled={!canEdit || saving} className="space-y-6 disabled:opacity-90">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('sections.content')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-1">
                <Label htmlFor="career-published">{t('published.label')}</Label>
                <p className="text-sm text-muted-foreground">{t('published.hint')}</p>
              </div>
              <Switch
                id="career-published"
                checked={form.published}
                onCheckedChange={(v) => set('published', v)}
                disabled={!canEdit}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="career-headline">{t('headline.label')}</Label>
              <Input
                id="career-headline"
                value={form.headline}
                maxLength={CAREER_LIMITS.headline}
                placeholder={t('headline.placeholder')}
                onChange={(e) => set('headline', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="career-subheadline">{t('subheadline.label')}</Label>
              <Input
                id="career-subheadline"
                value={form.subheadline}
                maxLength={CAREER_LIMITS.subheadline}
                placeholder={t('subheadline.placeholder')}
                onChange={(e) => set('subheadline', e.target.value)}
              />
            </div>

            <MarkdownEditor
              id="career-about"
              label={t('about.label')}
              value={form.about}
              onChange={(v) => set('about', v)}
              uploadUrl={canEdit ? CAREER_UPLOAD_URL : undefined}
              maxLength={CAREER_LIMITS.about}
              rows={12}
            />

            <BenefitsEditor value={form.benefits} onChange={(v) => set('benefits', v)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('sections.branding')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <CoverImageField value={form.coverImage} onChange={(v) => set('coverImage', v)} />

            <div className="space-y-2">
              <Label htmlFor="career-brand-color">{t('brandColor.label')}</Label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  aria-label={t('brandColor.picker')}
                  value={isHexColor(form.brandColor) ? form.brandColor : DEFAULT_COLOR}
                  onChange={(e) => set('brandColor', e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded border bg-transparent p-1"
                />
                <Input
                  id="career-brand-color"
                  value={form.brandColor}
                  maxLength={7}
                  placeholder="#2563eb"
                  className="w-32 font-mono"
                  aria-invalid={Boolean(errors.brandColor)}
                  aria-describedby="career-brand-color-hint"
                  onChange={(e) => set('brandColor', e.target.value.trim())}
                />
                {form.brandColor && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => set('brandColor', '')}
                  >
                    {t('brandColor.reset')}
                  </Button>
                )}
              </div>
              <p
                id="career-brand-color-hint"
                className={`text-sm ${errors.brandColor ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {errors.brandColor || t('brandColor.hint')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="career-video">{t('video.label')}</Label>
              <Input
                id="career-video"
                type="url"
                inputMode="url"
                value={form.videoUrl}
                maxLength={CAREER_LIMITS.url}
                placeholder="https://www.youtube.com/watch?v=…"
                aria-invalid={Boolean(errors.videoUrl)}
                aria-describedby="career-video-hint"
                onChange={(e) => set('videoUrl', e.target.value)}
              />
              <p
                id="career-video-hint"
                className={`text-sm ${errors.videoUrl ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {errors.videoUrl || t('video.hint')}
              </p>
            </div>
          </CardContent>
        </Card>

        {canEdit && (
          <div className="flex justify-end">
            <Button type="submit" disabled={saving || hasErrors}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {saving ? t('saving') : t('save')}
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  )
}
