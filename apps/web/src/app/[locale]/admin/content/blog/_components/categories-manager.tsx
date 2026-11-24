'use client'

/** Blog categories: create, rename per locale, re-slug, reorder (up/down) and delete. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { CMS_LOCALES, SLUG_MAX, SLUG_REGEX, slugify } from '@/lib/cms/constants'
import { BLOG_CATEGORY_NAME_MAX, categoryName } from '@/lib/blog/shared'

export interface CategoryRow {
  id: string
  slug: string
  names: Record<string, string>
  postCount: number
}

const emptyNames = () =>
  Object.fromEntries(CMS_LOCALES.map((l) => [l, ''])) as Record<string, string>

export function CategoriesManager({ locale, initial }: { locale: string; initial: CategoryRow[] }) {
  const t = useTranslations('adminBlog.categories')
  const tb = useTranslations('adminBlog')
  const router = useRouter()
  const [items, setItems] = useState(initial)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function request(url: string, method: string, body?: unknown) {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (res.status === 409) throw new Error(t('slugTaken'))
    if (res.status === 503) throw new Error(tb('notMigrated'))
    if (!res.ok) throw new Error(data.error ?? t('saveFailed'))
    return data
  }

  async function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    const previous = items
    setItems(next)
    try {
      await request('/api/admin/cms/blog/categories', 'PUT', { order: next.map((c) => c.id) })
      router.refresh()
    } catch (e) {
      setItems(previous)
      toast.error((e as Error).message)
    }
  }

  async function remove(id: string) {
    setBusyId(id)
    try {
      await request(`/api/admin/cms/blog/categories/${encodeURIComponent(id)}`, 'DELETE')
      setItems((list) => list.filter((c) => c.id !== id))
      toast.success(t('deleted'))
      router.refresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      <CategoryEditor
        key={`new-${items.length}`}
        mode="create"
        onSave={async (slug, names) => {
          const data = (await request('/api/admin/cms/blog/categories', 'POST', {
            slug,
            names,
          })) as { category?: { id: string; slug: string } }
          if (data.category) {
            setItems((list) => [
              ...list,
              { id: data.category!.id, slug: data.category!.slug, names, postCount: 0 },
            ])
          }
          toast.success(t('created'))
          router.refresh()
        }}
      />

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((c, index) => (
            <li key={c.id} className="rounded-lg border p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{categoryName(c.names, locale, c.slug)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    /{c.slug} · {t('postCount', { count: c.postCount })}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    aria-label={t('moveUp')}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={index === items.length - 1}
                    onClick={() => move(index, 1)}
                    aria-label={t('moveDown')}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        disabled={busyId === c.id}
                      >
                        {tb('actions.delete')}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('deleteDescription', {
                            name: categoryName(c.names, locale, c.slug),
                            count: c.postCount,
                          })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{tb('deleteDialog.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => remove(c.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {tb('deleteDialog.confirm')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
              <CategoryEditor
                mode="edit"
                initialSlug={c.slug}
                initialNames={c.names}
                onSave={async (slug, names) => {
                  await request(
                    `/api/admin/cms/blog/categories/${encodeURIComponent(c.id)}`,
                    'PATCH',
                    {
                      slug,
                      names,
                    },
                  )
                  setItems((list) => list.map((x) => (x.id === c.id ? { ...x, slug, names } : x)))
                  toast.success(t('saved'))
                  router.refresh()
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CategoryEditor({
  mode,
  initialSlug = '',
  initialNames,
  onSave,
}: {
  mode: 'create' | 'edit'
  initialSlug?: string
  initialNames?: Record<string, string>
  onSave: (slug: string, names: Record<string, string>) => Promise<void>
}) {
  const t = useTranslations('adminBlog.categories')
  const [slug, setSlug] = useState(initialSlug)
  const [slugTouched, setSlugTouched] = useState(mode === 'edit')
  const [names, setNames] = useState<Record<string, string>>(initialNames ?? emptyNames())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const idPrefix = mode === 'create' ? 'cat-new' : `cat-${initialSlug}`

  function setName(l: string, value: string) {
    setNames((n) => ({ ...n, [l]: value }))
    if (!slugTouched && l === 'sk') setSlug(slugify(value))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!SLUG_REGEX.test(slug)) {
      setError(t('slugInvalid'))
      return
    }
    const filled = Object.fromEntries(
      Object.entries(names)
        .map(([k, v]) => [k, v.trim()] as const)
        .filter(([, v]) => v),
    )
    if (Object.keys(filled).length === 0) {
      setError(t('nameRequired'))
      return
    }
    setSaving(true)
    try {
      await onSave(slug, filled)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className={mode === 'create' ? 'space-y-3 rounded-lg border bg-muted/30 p-4' : 'space-y-3'}
      noValidate
    >
      {mode === 'create' && <h3 className="font-medium">{t('newTitle')}</h3>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CMS_LOCALES.map((l) => (
          <div key={l} className="space-y-1">
            <Label htmlFor={`${idPrefix}-name-${l}`}>
              {t('nameIn', { locale: l.toUpperCase() })}
            </Label>
            <Input
              id={`${idPrefix}-name-${l}`}
              value={names[l] ?? ''}
              onChange={(e) => setName(l, e.target.value)}
              maxLength={BLOG_CATEGORY_NAME_MAX}
            />
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-slug`}>{t('slug')}</Label>
          <Input
            id={`${idPrefix}-slug`}
            value={slug}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(e.target.value.toLowerCase())
            }}
            maxLength={SLUG_MAX}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" disabled={saving}>
        {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {mode === 'create' ? t('create') : t('save')}
      </Button>
    </form>
  )
}
