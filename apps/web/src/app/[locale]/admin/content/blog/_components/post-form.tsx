'use client'

/**
 * Create / edit a blog post. Times are entered in Europe/Bratislava wall-clock time and
 * sent as ISO instants; a PUBLISHED post with a future date is scheduled.
 */

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownEditor } from '@/components/cms/markdown-editor'
import { CMS_LOCALES, SLUG_MAX, SLUG_REGEX, isCmsLocale, slugify } from '@/lib/cms/constants'
import {
  BLOG_EXCERPT_MAX,
  BLOG_SEO_DESCRIPTION_MAX,
  BLOG_SEO_TITLE_MAX,
  BLOG_TAGS_MAX,
  BLOG_TAG_LENGTH_MAX,
  BLOG_TITLE_MAX,
  fromZonedInputValue,
  isLive,
  isScheduled,
  toZonedInputValue,
} from '@/lib/blog/shared'
import { DeletePostButton } from './delete-post-button'

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

const UPLOAD_URL = '/api/admin/cms/upload'

export interface PostFormValues {
  id: string
  locale: string
  title: string
  slug: string
  excerpt: string | null
  body: string
  coverImage: string | null
  categoryId: string | null
  tags: string[]
  seoTitle: string | null
  seoDescription: string | null
  status: 'DRAFT' | 'PUBLISHED'
  publishedAt: string | null
}

export function PostForm({
  locale,
  categories,
  post,
}: {
  /** Admin UI locale (for links). */
  locale: string
  categories: { id: string; label: string }[]
  post?: PostFormValues
}) {
  const t = useTranslations('adminBlog.form')
  const tb = useTranslations('adminBlog')
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    locale: post?.locale ?? (isCmsLocale(locale) ? locale : 'sk'),
    title: post?.title ?? '',
    slug: post?.slug ?? '',
    excerpt: post?.excerpt ?? '',
    body: post?.body ?? '',
    coverImage: post?.coverImage ?? '',
    categoryId: post?.categoryId ?? '',
    tags: (post?.tags ?? []).join(', '),
    seoTitle: post?.seoTitle ?? '',
    seoDescription: post?.seoDescription ?? '',
    status: post?.status ?? ('DRAFT' as 'DRAFT' | 'PUBLISHED'),
    publishedAt: toZonedInputValue(post?.publishedAt ?? null),
  })
  const [slugTouched, setSlugTouched] = useState(!!post)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slugError, setSlugError] = useState<string | null>(null)

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function onTitleChange(value: string) {
    setForm((f) => ({ ...f, title: value, ...(slugTouched ? {} : { slug: slugify(value) }) }))
  }

  const tagList = form.tags
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const tagsInvalid =
    tagList.length > BLOG_TAGS_MAX || tagList.some((tag) => tag.length > BLOG_TAG_LENGTH_MAX)

  const plannedDate = fromZonedInputValue(form.publishedAt)
  const willBeScheduled =
    form.status === 'PUBLISHED' && !!plannedDate && plannedDate.getTime() > Date.now()

  async function uploadCover(file: File) {
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(UPLOAD_URL, { method: 'POST', body })
      const data = (await res.json().catch(() => ({}))) as { url?: string }
      if (!res.ok || !data.url) throw new Error(String(res.status))
      update('coverImage', data.url)
    } catch {
      toast.error(t('coverUploadFailed'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSlugError(null)
    if (!SLUG_REGEX.test(form.slug)) {
      setSlugError(t('slugInvalid'))
      return
    }
    if (tagsInvalid) {
      setError(t('tagsInvalid', { max: BLOG_TAGS_MAX, length: BLOG_TAG_LENGTH_MAX }))
      return
    }

    const payload = {
      locale: form.locale,
      title: form.title,
      slug: form.slug,
      excerpt: form.excerpt,
      body: form.body,
      coverImage: form.coverImage,
      categoryId: form.categoryId,
      tags: tagList,
      seoTitle: form.seoTitle,
      seoDescription: form.seoDescription,
      status: form.status,
      publishedAt: plannedDate ? plannedDate.toISOString() : null,
    }

    setSaving(true)
    try {
      const res = await fetch(
        post
          ? `/api/admin/cms/blog/posts/${encodeURIComponent(post.id)}`
          : '/api/admin/cms/blog/posts',
        {
          method: post ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const data = (await res.json().catch(() => ({}))) as {
        post?: { id: string }
        error?: string
        issues?: { path: (string | number)[]; message: string }[]
      }
      if (res.status === 409) {
        setSlugError(t('slugTaken'))
        return
      }
      if (res.status === 503) {
        setError(tb('notMigrated'))
        return
      }
      if (!res.ok) {
        const issue = data.issues?.[0]
        setError(
          issue ? `${issue.path.join('.')}: ${issue.message}` : (data.error ?? t('saveFailed')),
        )
        return
      }
      toast.success(t('saved'))
      if (!post && data.post?.id) {
        router.push(`/${locale}/admin/content/blog/${data.post.id}`)
      }
      router.refresh()
    } catch {
      setError(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const savedLive = post ? isLive(post) : false
  const savedScheduled = post ? isScheduled(post) : false

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{post ? t('editTitle') : t('newTitle')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {savedScheduled && post?.publishedAt && (
            <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
              {t('scheduledFor', { date: toZonedInputValue(post.publishedAt).replace('T', ' ') })}
            </span>
          )}
          {post && savedLive && (
            <Button asChild variant="outline" size="sm">
              <a
                href={`/${post.locale}/blog/${post.slug}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {tb('actions.view')}
              </a>
            </Button>
          )}
          {post && (
            <DeletePostButton
              id={post.id}
              title={post.title}
              redirectTo={`/${locale}/admin/content/blog`}
            />
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="blog-title">{t('title')}</Label>
            <Input
              id="blog-title"
              value={form.title}
              onChange={(e) => onTitleChange(e.target.value)}
              maxLength={BLOG_TITLE_MAX}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="blog-slug">{t('slug')}</Label>
            <Input
              id="blog-slug"
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true)
                update('slug', e.target.value.toLowerCase())
              }}
              maxLength={SLUG_MAX}
              aria-invalid={!!slugError}
              aria-describedby="blog-slug-help"
              required
            />
            <p
              id="blog-slug-help"
              className={`text-xs ${slugError ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {slugError ?? t('slugHelp', { path: `/${form.locale}/blog/${form.slug || '…'}` })}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="blog-excerpt">{t('excerpt')}</Label>
            <Textarea
              id="blog-excerpt"
              value={form.excerpt}
              onChange={(e) => update('excerpt', e.target.value)}
              maxLength={BLOG_EXCERPT_MAX}
              rows={3}
              aria-describedby="blog-excerpt-help"
            />
            <p id="blog-excerpt-help" className="text-xs text-muted-foreground">
              {t('excerptHelp', { count: form.excerpt.length, max: BLOG_EXCERPT_MAX })}
            </p>
          </div>

          <MarkdownEditor
            id="blog-body"
            label={t('body')}
            value={form.body}
            onChange={(v) => update('body', v)}
            uploadUrl={UPLOAD_URL}
            rows={22}
            required
          />
        </div>

        <aside className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="blog-locale">{t('locale')}</Label>
            <select
              id="blog-locale"
              value={form.locale}
              onChange={(e) => update('locale', e.target.value)}
              className={SELECT_CLASS}
            >
              {CMS_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="blog-status">{t('status')}</Label>
            <select
              id="blog-status"
              value={form.status}
              onChange={(e) => update('status', e.target.value as 'DRAFT' | 'PUBLISHED')}
              className={SELECT_CLASS}
            >
              <option value="DRAFT">{tb('status.DRAFT')}</option>
              <option value="PUBLISHED">{tb('status.PUBLISHED')}</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="blog-published-at">{t('publishedAt')}</Label>
            <Input
              id="blog-published-at"
              type="datetime-local"
              value={form.publishedAt}
              onChange={(e) => update('publishedAt', e.target.value)}
              aria-describedby="blog-published-at-help"
            />
            <p id="blog-published-at-help" className="text-xs text-muted-foreground">
              {willBeScheduled ? t('publishedAtScheduled') : t('publishedAtHelp')}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="blog-category">{t('category')}</Label>
            <select
              id="blog-category"
              value={form.categoryId}
              onChange={(e) => update('categoryId', e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">{t('noCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="blog-tags">{t('tags')}</Label>
            <Input
              id="blog-tags"
              value={form.tags}
              onChange={(e) => update('tags', e.target.value)}
              aria-invalid={tagsInvalid}
              aria-describedby="blog-tags-help"
            />
            <p
              id="blog-tags-help"
              className={`text-xs ${tagsInvalid ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {t('tagsHelp', { max: BLOG_TAGS_MAX, count: tagList.length })}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="blog-cover">{t('coverImage')}</Label>
            {form.coverImage ? (
              <div className="relative aspect-[16/9] overflow-hidden rounded-md border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of an arbitrary https URL */}
                <img
                  src={form.coverImage}
                  alt={t('coverPreviewAlt')}
                  width={320}
                  height={180}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="secondary"
                  className="absolute right-2 top-2 h-8 w-8"
                  onClick={() => update('coverImage', '')}
                  aria-label={t('coverRemove')}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ) : null}
            <Input
              id="blog-cover"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={form.coverImage}
              onChange={(e) => update('coverImage', e.target.value)}
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void uploadCover(file)
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ImagePlus className="mr-2 h-4 w-4" aria-hidden="true" />
              )}
              {t('coverUpload')}
            </Button>
          </div>

          <fieldset className="space-y-3 rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{t('seo')}</legend>
            <div className="space-y-2">
              <Label htmlFor="blog-seo-title">{t('seoTitle')}</Label>
              <Input
                id="blog-seo-title"
                value={form.seoTitle}
                onChange={(e) => update('seoTitle', e.target.value)}
                maxLength={BLOG_SEO_TITLE_MAX}
                placeholder={form.title}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="blog-seo-description">{t('seoDescription')}</Label>
              <Textarea
                id="blog-seo-description"
                value={form.seoDescription}
                onChange={(e) => update('seoDescription', e.target.value)}
                maxLength={BLOG_SEO_DESCRIPTION_MAX}
                rows={3}
                placeholder={form.excerpt}
              />
            </div>
          </fieldset>
        </aside>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={saving || uploading}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {form.status === 'PUBLISHED'
            ? willBeScheduled
              ? t('submitSchedule')
              : t('submitPublish')
            : t('submitDraft')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(`/${locale}/admin/content/blog`)}
        >
          {t('cancel')}
        </Button>
      </div>
    </form>
  )
}
