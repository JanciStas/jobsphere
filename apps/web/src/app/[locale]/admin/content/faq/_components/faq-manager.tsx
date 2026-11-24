'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, ExternalLink, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MarkdownEditor } from '@/components/cms/markdown-editor'

// Mirrors lib/cms/faq.ts (that module imports Prisma and must stay out of the client bundle).
const QUESTION_MAX = 300
const ANSWER_MAX = 20_000
const FIELD = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm'

export interface AdminFaqItem {
  id: string
  category: string
  question: string
  answer: string
  published: boolean
}

interface FaqManagerProps {
  lang: string
  items: AdminFaqItem[]
  categories: string[]
  publicHref: string
}

type Draft = Omit<AdminFaqItem, 'id'>

function emptyDraft(categories: string[]): Draft {
  return { category: categories[0] ?? 'general', question: '', answer: '', published: false }
}

export function FaqManager({ lang, items, categories, publicHref }: FaqManagerProps) {
  const t = useTranslations('adminCmsFaq')
  const router = useRouter()
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft(categories))
  const [busy, setBusy] = useState<string | null>(null)

  function startNew() {
    setDraft(emptyDraft(categories))
    setEditing('new')
  }

  function startEdit(item: AdminFaqItem) {
    setDraft({
      category: item.category,
      question: item.question,
      answer: item.answer,
      published: item.published,
    })
    setEditing(item.id)
  }

  async function call(key: string, url: string, init: RequestInit, success: string) {
    setBusy(key)
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { code?: string }
        toast.error(data.code === 'cms_not_migrated' ? t('notMigrated') : t('saveFailed'))
        return false
      }
      if (success) toast.success(success)
      router.refresh()
      return true
    } catch {
      toast.error(t('saveFailed'))
      return false
    } finally {
      setBusy(null)
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    const isNew = editing === 'new'
    const ok = await call(
      'save',
      isNew ? '/api/admin/cms/faq' : `/api/admin/cms/faq/${editing}`,
      {
        method: isNew ? 'POST' : 'PATCH',
        body: JSON.stringify(isNew ? { locale: lang, ...draft } : draft),
      },
      t('saved'),
    )
    if (ok) setEditing(null)
  }

  async function remove(item: AdminFaqItem) {
    if (!window.confirm(t('deleteConfirm', { question: item.question }))) return
    const ok = await call(
      `delete-${item.id}`,
      `/api/admin/cms/faq/${item.id}`,
      { method: 'DELETE' },
      t('deleted'),
    )
    if (ok && editing === item.id) setEditing(null)
  }

  function move(item: AdminFaqItem, direction: 'up' | 'down') {
    void call(
      `move-${item.id}`,
      `/api/admin/cms/faq/${item.id}/move`,
      { method: 'POST', body: JSON.stringify({ direction }) },
      '',
    )
  }

  const form = (
    <form onSubmit={save} className="space-y-4 rounded-lg border bg-muted/20 p-4">
      <h3 className="font-semibold">{editing === 'new' ? t('newTitle') : t('editTitle')}</h3>
      <div className="grid gap-4 md:grid-cols-[1fr_200px]">
        <div className="space-y-1.5">
          <Label htmlFor="faq-question">{t('fields.question')}</Label>
          <Input
            id="faq-question"
            required
            maxLength={QUESTION_MAX}
            value={draft.question}
            onChange={(e) => setDraft((d) => ({ ...d, question: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="faq-category">{t('fields.category')}</Label>
          <select
            id="faq-category"
            className={FIELD}
            value={draft.category}
            onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <MarkdownEditor
        id="faq-answer"
        label={t('fields.answer')}
        value={draft.answer}
        onChange={(answer) => setDraft((d) => ({ ...d, answer }))}
        uploadUrl="/api/admin/cms/upload"
        rows={8}
        maxLength={ANSWER_MAX}
        required
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={draft.published}
          onChange={(e) => setDraft((d) => ({ ...d, published: e.target.checked }))}
        />
        {t('fields.published')}
      </label>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy !== null}>
          {busy === 'save' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
          {t('save')}
        </Button>
        <Button type="button" variant="outline" onClick={() => setEditing(null)}>
          {t('cancel')}
        </Button>
      </div>
    </form>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={startNew} disabled={editing === 'new'}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          {t('add')}
        </Button>
        <Button variant="outline" asChild>
          <Link href={publicHref} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('viewPublic')}
          </Link>
        </Button>
      </div>

      {editing === 'new' && form}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ol className="divide-y rounded-lg border">
          {items.map((item, index) => (
            <li key={item.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{item.question}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {t(
                        `categories.${categories.includes(item.category) ? item.category : 'general'}`,
                      )}
                    </Badge>
                    {item.published ? (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                        {t('published')}
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                        {t('draft')}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t('moveUp')}
                    disabled={index === 0 || busy !== null}
                    onClick={() => move(item, 'up')}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t('moveDown')}
                    disabled={index === items.length - 1 || busy !== null}
                    onClick={() => move(item, 'down')}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t('edit')}
                    onClick={() => startEdit(item)}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t('delete')}
                    disabled={busy !== null}
                    onClick={() => remove(item)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {editing === item.id && form}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
