'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ExternalLink, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownEditor } from '@/components/cms/markdown-editor'

// Mirrors lib/cms/pages.ts (that module imports Prisma and must stay out of the client bundle).
const TITLE_MAX = 200
const SEO_TITLE_MAX = 120
const SEO_DESCRIPTION_MAX = 320
const FIELD = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

interface PageEditFormProps {
  slug: string
  lang: string
  exists: boolean
  initial: {
    title: string
    body: string
    seoTitle: string
    seoDescription: string
    status: 'DRAFT' | 'PUBLISHED'
  }
  backHref: string
  publicHref: string
}

/** Edit one CMS page version (slug + locale): title, Markdown body, SEO, status. */
export function PageEditForm({
  slug,
  lang,
  exists,
  initial,
  backHref,
  publicHref,
}: PageEditFormProps) {
  const t = useTranslations('adminCmsPages')
  const router = useRouter()
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function errorMessage(res: Response) {
    const data = (await res.json().catch(() => ({}))) as { code?: string }
    return data.code === 'cms_not_migrated' ? t('notMigrated') : t('saveFailed')
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/admin/cms/pages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, locale: lang, ...form }),
      })
      if (!res.ok) {
        toast.error(await errorMessage(res))
        return
      }
      toast.success(form.status === 'PUBLISHED' ? t('savedPublished') : t('savedDraft'))
      router.refresh()
    } catch {
      toast.error(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!window.confirm(t('deleteConfirm'))) return
    setDeleting(true)
    try {
      const params = new URLSearchParams({ slug, locale: lang })
      const res = await fetch(`/api/admin/cms/pages?${params}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error(await errorMessage(res))
        return
      }
      toast.success(t('deleted'))
      router.push(backHref)
      router.refresh()
    } catch {
      toast.error(t('saveFailed'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="cms-page-title">{t('fields.title')}</Label>
        <Input
          id="cms-page-title"
          required
          maxLength={TITLE_MAX}
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
        />
      </div>

      <MarkdownEditor
        id="cms-page-body"
        label={t('fields.body')}
        value={form.body}
        onChange={(value) => set('body', value)}
        uploadUrl="/api/admin/cms/upload"
        required
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cms-page-seo-title">{t('fields.seoTitle')}</Label>
          <Input
            id="cms-page-seo-title"
            maxLength={SEO_TITLE_MAX}
            value={form.seoTitle}
            onChange={(e) => set('seoTitle', e.target.value)}
            aria-describedby="cms-page-seo-title-hint"
          />
          <p id="cms-page-seo-title-hint" className="text-xs text-muted-foreground">
            {t('fields.seoTitleHint', { count: form.seoTitle.length, max: SEO_TITLE_MAX })}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cms-page-status">{t('fields.status')}</Label>
          <select
            id="cms-page-status"
            className={FIELD}
            value={form.status}
            onChange={(e) => set('status', e.target.value as 'DRAFT' | 'PUBLISHED')}
          >
            <option value="DRAFT">{t('status.draft')}</option>
            <option value="PUBLISHED">{t('status.published')}</option>
          </select>
          <p className="text-xs text-muted-foreground">{t('fields.statusHint')}</p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="cms-page-seo-description">{t('fields.seoDescription')}</Label>
        <Textarea
          id="cms-page-seo-description"
          rows={3}
          maxLength={SEO_DESCRIPTION_MAX}
          value={form.seoDescription}
          onChange={(e) => set('seoDescription', e.target.value)}
          aria-describedby="cms-page-seo-description-hint"
        />
        <p id="cms-page-seo-description-hint" className="text-xs text-muted-foreground">
          {t('fields.seoDescriptionHint', {
            count: form.seoDescription.length,
            max: SEO_DESCRIPTION_MAX,
          })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="submit" disabled={saving || deleting}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {t('save')}
        </Button>
        <Button variant="outline" asChild>
          <Link href={publicHref} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('viewPublic')}
          </Link>
        </Button>
        {exists && (
          <Button
            type="button"
            variant="destructive"
            className="ml-auto"
            disabled={saving || deleting}
            onClick={remove}
          >
            {deleting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {t('delete')}
          </Button>
        )}
      </div>
    </form>
  )
}
