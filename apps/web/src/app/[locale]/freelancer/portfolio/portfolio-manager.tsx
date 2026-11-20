'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface PortfolioItemView {
  id: string
  title: string
  description: string | null
  url: string | null
  imageUrl: string | null
  tags: string[]
  sortOrder: number
}

interface FormState {
  title: string
  description: string
  url: string
  imageUrl: string
  tags: string // comma separated
}

const EMPTY: FormState = { title: '', description: '', url: '', imageUrl: '', tags: '' }

export function PortfolioManager({
  initialItems,
  hasProfile,
}: {
  initialItems: PortfolioItemView[]
  hasProfile: boolean
}) {
  const t = useTranslations('freelancerDashboard.portfolio')
  const router = useRouter()
  const [items, setItems] = useState(initialItems)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const fail = (status: number, fallback: string) =>
    setError(status === 503 ? t('unavailable') : status === 409 ? t('limit') : fallback)

  const startNew = () => {
    setEditingId(null)
    setForm(EMPTY)
    setError('')
    setOpen(true)
  }

  const startEdit = (it: PortfolioItemView) => {
    setEditingId(it.id)
    setForm({
      title: it.title,
      description: it.description ?? '',
      url: it.url ?? '',
      imageUrl: it.imageUrl ?? '',
      tags: it.tags.join(', '),
    })
    setError('')
    setOpen(true)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const tags = form.tags
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      url: form.url.trim() || null,
      imageUrl: form.imageUrl.trim() || null,
      tags,
    }
    try {
      const res = await fetch(
        editingId ? `/api/freelancer/portfolio/${editingId}` : '/api/freelancer/portfolio',
        {
          method: editingId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) return fail(res.status, t('saveFailed'))
      const { item } = (await res.json()) as { item: PortfolioItemView }
      setItems((prev) =>
        editingId ? prev.map((p) => (p.id === item.id ? item : p)) : [...prev, item],
      )
      setOpen(false)
      router.refresh()
    } catch {
      setError(t('saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!window.confirm(t('confirmDelete'))) return
    setError('')
    try {
      const res = await fetch(`/api/freelancer/portfolio/${id}`, { method: 'DELETE' })
      if (!res.ok) return fail(res.status, t('deleteFailed'))
      setItems((prev) => prev.filter((p) => p.id !== id))
      router.refresh()
    } catch {
      setError(t('deleteFailed'))
    }
  }

  const move = async (index: number, dir: -1 | 1) => {
    const other = index + dir
    if (other < 0 || other >= items.length) return
    const a = items[index]
    const b = items[other]
    // Swap sortOrder; if equal (legacy rows), fall back to positional values.
    const aOrder = a.sortOrder === b.sortOrder ? other : b.sortOrder
    const bOrder = a.sortOrder === b.sortOrder ? index : a.sortOrder
    setError('')
    try {
      const results = await Promise.all([
        fetch(`/api/freelancer/portfolio/${a.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortOrder: aOrder }),
        }),
        fetch(`/api/freelancer/portfolio/${b.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortOrder: bOrder }),
        }),
      ])
      if (results.some((r) => !r.ok))
        return fail(results.find((r) => !r.ok)!.status, t('saveFailed'))
      const next = [...items]
      next[index] = { ...b, sortOrder: bOrder }
      next[other] = { ...a, sortOrder: aOrder }
      setItems(next)
      router.refresh()
    } catch {
      setError(t('saveFailed'))
    }
  }

  return (
    <div className="space-y-4">
      {!hasProfile && <p className="text-sm text-muted-foreground">{t('needProfile')}</p>}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t('count', { count: items.length })}</p>
        <Button onClick={startNew} disabled={!hasProfile || open}>
          {t('add')}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {open && (
        <form onSubmit={submit} className="space-y-4 rounded-lg border bg-card p-4">
          <h2 className="font-semibold">{editingId ? t('edit') : t('add')}</h2>
          <div className="space-y-2">
            <Label htmlFor="pf-title">{t('fieldTitle')}</Label>
            <Input
              id="pf-title"
              required
              maxLength={120}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-desc">{t('description')}</Label>
            <textarea
              id="pf-desc"
              maxLength={2000}
              className="min-h-[90px] w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="pf-url">{t('url')}</Label>
              <Input
                id="pf-url"
                type="url"
                placeholder="https://…"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pf-img">{t('imageUrl')}</Label>
              <Input
                id="pf-img"
                type="url"
                placeholder="https://…"
                value={form.imageUrl}
                onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pf-tags">{t('tags')}</Label>
            <Input
              id="pf-tags"
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">{t('tagsHint')}</p>
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? t('saving') : t('save')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {items.map((it, i) => (
            <li key={it.id} className="flex flex-col overflow-hidden rounded-lg border bg-card">
              {it.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={it.imageUrl}
                  alt={it.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-40 w-full object-cover"
                />
              )}
              <div className="flex flex-1 flex-col gap-2 p-4">
                <p className="font-medium">{it.title}</p>
                {it.description && (
                  <p className="line-clamp-3 text-sm text-muted-foreground">{it.description}</p>
                )}
                {it.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {it.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-auto flex items-center gap-1 pt-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('moveUp')}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('moveDown')}
                    disabled={i === items.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('edit')}
                    onClick={() => startEdit(it)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('delete')}
                    onClick={() => remove(it.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
