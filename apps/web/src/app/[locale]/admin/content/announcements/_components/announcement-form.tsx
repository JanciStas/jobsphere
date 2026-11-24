'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { CMS_LOCALES, isSafeCmsLink, type CmsLocale } from '@/lib/cms/constants'
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_LABEL_MAX,
  ANNOUNCEMENT_MESSAGE_MAX,
  ANNOUNCEMENT_VARIANTS,
  dateToBratislavaLocal,
  type AnnouncementAudience,
  type AnnouncementVariant,
} from '@/lib/cms/announcements-shared'
import { ANNOUNCEMENT_VARIANT_CLASSES } from '@/components/layout/announcement-bar-client'
import type { AdminAnnouncement } from './admin-announcement'

type LocaleMap = Record<CmsLocale, string>
type FieldErrors = Partial<Record<'message' | 'linkUrl' | 'endsAt' | 'form', string>>

const emptyMap = (src?: Record<string, string>): LocaleMap =>
  Object.fromEntries(CMS_LOCALES.map((l) => [l, src?.[l] ?? ''])) as LocaleMap

const compact = (map: LocaleMap) =>
  Object.fromEntries(
    CMS_LOCALES.map((l) => [l, map[l].trim()] as const).filter(([, v]) => v.length > 0),
  )

export function AnnouncementForm({
  locale,
  initial,
}: {
  locale: string
  initial?: AdminAnnouncement
}) {
  const t = useTranslations('adminAnnouncements')
  const router = useRouter()
  const listHref = `/${locale}/admin/content/announcements`

  const [message, setMessage] = useState<LocaleMap>(() => emptyMap(initial?.message))
  const [linkUrl, setLinkUrl] = useState(initial?.linkUrl ?? '')
  const [linkLabel, setLinkLabel] = useState<LocaleMap>(() => emptyMap(initial?.linkLabel))
  const [variant, setVariant] = useState<AnnouncementVariant>(initial?.variant ?? 'info')
  const [audience, setAudience] = useState<AnnouncementAudience>(initial?.audience ?? 'all')
  const [startsAt, setStartsAt] = useState(
    initial?.startsAt ? dateToBratislavaLocal(initial.startsAt) : '',
  )
  const [endsAt, setEndsAt] = useState(initial?.endsAt ? dateToBratislavaLocal(initial.endsAt) : '')
  const [active, setActive] = useState(initial?.active ?? false)
  const [dismissible, setDismissible] = useState(initial?.dismissible ?? true)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)

  const validate = (): FieldErrors => {
    const next: FieldErrors = {}
    if (!message.sk.trim()) next.message = t('form.errors.messageRequired')
    const url = linkUrl.trim()
    if (url && !isSafeCmsLink(url)) next.linkUrl = t('form.errors.linkInvalid')
    // datetime-local values in the same zone compare correctly as strings.
    if (startsAt && endsAt && endsAt <= startsAt) next.endsAt = t('form.errors.windowInvalid')
    return next
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return

    const url = linkUrl.trim()
    const body = {
      message: compact(message),
      linkUrl: url || null,
      linkLabel: url ? compact(linkLabel) : {},
      variant,
      audience,
      // Sent as datetime-local strings; the API interprets them in Europe/Bratislava.
      startsAt: startsAt || null,
      endsAt: endsAt || null,
      active,
      dismissible,
    }

    setSaving(true)
    try {
      const res = await fetch(
        initial
          ? `/api/admin/cms/announcements/${encodeURIComponent(initial.id)}`
          : '/api/admin/cms/announcements',
        {
          method: initial ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        if (res.status === 400 && Array.isArray(data?.issues)) {
          const fromServer: FieldErrors = {}
          for (const issue of data.issues as { path?: unknown[] }[]) {
            const field = issue.path?.[0]
            if (field === 'message') fromServer.message = t('form.errors.messageRequired')
            else if (field === 'linkUrl') fromServer.linkUrl = t('form.errors.linkInvalid')
            else if (field === 'endsAt' || field === 'startsAt')
              fromServer.endsAt = t('form.errors.windowInvalid')
          }
          setErrors(fromServer)
        }
        toast.error(
          res.status === 503
            ? t('errors.notMigrated')
            : res.status === 404
              ? t('errors.notFound')
              : res.status === 400
                ? t('errors.validation')
                : t('errors.generic'),
        )
        return
      }
      toast.success(initial ? t('toasts.updated') : t('toasts.created'))
      router.push(listHref)
      router.refresh()
    } catch {
      toast.error(t('errors.generic'))
    } finally {
      setSaving(false)
    }
  }

  const previewText = message.sk.trim() || t('form.previewPlaceholder')
  const previewLabel = linkLabel.sk.trim() || t('form.previewLinkLabel')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={listHref}>
            <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('form.back')}
          </Link>
        </Button>
        <h2 className="text-lg font-semibold">
          {initial ? t('form.editTitle') : t('form.createTitle')}
        </h2>
      </div>

      <form onSubmit={submit} noValidate className="space-y-6">
        <fieldset className="space-y-4 rounded-xl border bg-card p-6">
          <legend className="px-1 text-base font-semibold">{t('form.messageSection')}</legend>
          <p className="text-sm text-muted-foreground">{t('form.messageHint')}</p>
          {CMS_LOCALES.map((l) => {
            const id = `announcement-message-${l}`
            const required = l === 'sk'
            const invalid = required && Boolean(errors.message)
            return (
              <div key={l} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor={id}>
                    {t('form.messageLabel', { language: t(`locales.${l}`) })}{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      {required ? t('form.required') : t('form.optional')}
                    </span>
                  </Label>
                  <span className="text-xs text-muted-foreground" aria-hidden="true">
                    {message[l].length}/{ANNOUNCEMENT_MESSAGE_MAX}
                  </span>
                </div>
                <Textarea
                  id={id}
                  rows={2}
                  maxLength={ANNOUNCEMENT_MESSAGE_MAX}
                  required={required}
                  value={message[l]}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? 'announcement-message-error' : undefined}
                  onChange={(e) => setMessage((m) => ({ ...m, [l]: e.target.value }))}
                />
                {invalid ? (
                  <p id="announcement-message-error" className="text-sm text-destructive">
                    {errors.message}
                  </p>
                ) : null}
              </div>
            )
          })}
        </fieldset>

        <fieldset className="space-y-4 rounded-xl border bg-card p-6">
          <legend className="px-1 text-base font-semibold">{t('form.linkSection')}</legend>
          <div className="space-y-2">
            <Label htmlFor="announcement-link-url">{t('form.linkUrlLabel')}</Label>
            <Input
              id="announcement-link-url"
              inputMode="url"
              placeholder="/sk/jobs"
              value={linkUrl}
              aria-invalid={Boolean(errors.linkUrl) || undefined}
              aria-describedby={
                errors.linkUrl
                  ? 'announcement-link-url-hint announcement-link-url-error'
                  : 'announcement-link-url-hint'
              }
              onChange={(e) => setLinkUrl(e.target.value)}
            />
            <p id="announcement-link-url-hint" className="text-xs text-muted-foreground">
              {t('form.linkUrlHint')}
            </p>
            {errors.linkUrl ? (
              <p id="announcement-link-url-error" className="text-sm text-destructive">
                {errors.linkUrl}
              </p>
            ) : null}
          </div>
          {linkUrl.trim() ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {CMS_LOCALES.map((l) => {
                const id = `announcement-link-label-${l}`
                return (
                  <div key={l} className="space-y-2">
                    <Label htmlFor={id}>
                      {t('form.linkLabelLabel', { language: t(`locales.${l}`) })}
                    </Label>
                    <Input
                      id={id}
                      maxLength={ANNOUNCEMENT_LABEL_MAX}
                      placeholder={t('form.linkLabelPlaceholder')}
                      value={linkLabel[l]}
                      onChange={(e) => setLinkLabel((m) => ({ ...m, [l]: e.target.value }))}
                    />
                  </div>
                )
              })}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="space-y-4 rounded-xl border bg-card p-6">
          <legend className="px-1 text-base font-semibold">{t('form.settingsSection')}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="announcement-variant">{t('form.variantLabel')}</Label>
              <Select value={variant} onValueChange={(v) => setVariant(v as AnnouncementVariant)}>
                <SelectTrigger id="announcement-variant">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANNOUNCEMENT_VARIANTS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {t(`variants.${v}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="announcement-audience">{t('form.audienceLabel')}</Label>
              <Select
                value={audience}
                onValueChange={(v) => setAudience(v as AnnouncementAudience)}
              >
                <SelectTrigger id="announcement-audience">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANNOUNCEMENT_AUDIENCES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {t(`audiences.${a}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="announcement-starts-at">{t('form.startsAtLabel')}</Label>
              <Input
                id="announcement-starts-at"
                type="datetime-local"
                value={startsAt}
                aria-describedby="announcement-schedule-hint"
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="announcement-ends-at">{t('form.endsAtLabel')}</Label>
              <Input
                id="announcement-ends-at"
                type="datetime-local"
                value={endsAt}
                min={startsAt || undefined}
                aria-invalid={Boolean(errors.endsAt) || undefined}
                aria-describedby={
                  errors.endsAt
                    ? 'announcement-schedule-hint announcement-ends-at-error'
                    : 'announcement-schedule-hint'
                }
                onChange={(e) => setEndsAt(e.target.value)}
              />
              {errors.endsAt ? (
                <p id="announcement-ends-at-error" className="text-sm text-destructive">
                  {errors.endsAt}
                </p>
              ) : null}
            </div>
          </div>
          <p id="announcement-schedule-hint" className="text-xs text-muted-foreground">
            {t('form.timeZoneHint')}
          </p>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div>
              <Label htmlFor="announcement-active">{t('form.activeLabel')}</Label>
              <p id="announcement-active-hint" className="text-sm text-muted-foreground">
                {t('form.activeHint')}
              </p>
            </div>
            <Switch
              id="announcement-active"
              checked={active}
              onCheckedChange={setActive}
              aria-describedby="announcement-active-hint"
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div>
              <Label htmlFor="announcement-dismissible">{t('form.dismissibleLabel')}</Label>
              <p id="announcement-dismissible-hint" className="text-sm text-muted-foreground">
                {t('form.dismissibleHint')}
              </p>
            </div>
            <Switch
              id="announcement-dismissible"
              checked={dismissible}
              onCheckedChange={setDismissible}
              aria-describedby="announcement-dismissible-hint"
            />
          </div>
        </fieldset>

        <section aria-labelledby="announcement-preview-heading" className="space-y-2">
          <h3 id="announcement-preview-heading" className="text-sm font-semibold">
            {t('form.preview')}
          </h3>
          <div
            className={cn(
              'flex min-h-11 items-center gap-2 rounded-lg border px-4 py-2 text-sm',
              ANNOUNCEMENT_VARIANT_CLASSES[variant],
            )}
          >
            <p className="min-w-0 flex-1">
              {previewText}
              {linkUrl.trim() ? (
                <span className="font-semibold underline underline-offset-2"> {previewLabel}</span>
              ) : null}
            </p>
            {dismissible ? (
              <span aria-hidden="true" className="px-2 text-base leading-none">
                ×
              </span>
            ) : null}
          </div>
        </section>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? t('form.saving') : t('form.save')}
          </Button>
          <Button asChild type="button" variant="outline">
            <Link href={listHref}>{t('form.cancel')}</Link>
          </Button>
        </div>
      </form>
    </div>
  )
}
