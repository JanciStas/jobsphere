'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { X, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Tag {
  id: string
  name: string
  color: string | null
}

/**
 * Tags on one candidate, plus creating a new one inline.
 *
 * The create path is deliberately separate from the attach path — /api/tags owns
 * the vocabulary, /api/candidates/[id]/tags owns who wears what. Collapsing them
 * into a single free-text box is how you get "Senior", "senior" and "Snr" as
 * three different labels, which is the failure mode the String[] column already
 * had.
 */
export function CandidateTags({ candidateId }: { candidateId: string }) {
  const t = useTranslations('candidateTags')
  const [attached, setAttached] = useState<Tag[]>([])
  const [available, setAvailable] = useState<Tag[]>([])
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [mine, all] = await Promise.all([
        fetch(`/api/candidates/${candidateId}/tags`).then((r) => (r.ok ? r.json() : null)),
        fetch('/api/tags').then((r) => (r.ok ? r.json() : null)),
      ])
      setAttached(mine?.tags ?? [])
      setAvailable(all?.tags ?? [])
    } catch {
      // Tags are an aid, not the page. A failed load should not take the profile
      // down with it.
    }
  }, [candidateId])

  useEffect(() => {
    load()
  }, [load])

  const attach = async (tagId: string) => {
    setError(null)
    const res = await fetch(`/api/candidates/${candidateId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagId }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? t('addFailed'))
      return
    }
    await load()
  }

  const detach = async (tagId: string) => {
    await fetch(`/api/candidates/${candidateId}/tags?tagId=${encodeURIComponent(tagId)}`, {
      method: 'DELETE',
    })
    await load()
  }

  const createAndAttach = async (event: React.FormEvent) => {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return

    setError(null)
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })

    if (res.status === 409) {
      // Already in the vocabulary — attach the existing one rather than telling
      // the user off for a name that is exactly what they wanted.
      const existing = available.find((t) => t.name.toLowerCase() === name.toLowerCase())
      if (existing) {
        await attach(existing.id)
        setNewName('')
        setAdding(false)
        return
      }
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? t('createFailed'))
      return
    }

    const { tag } = await res.json()
    await attach(tag.id)
    setNewName('')
    setAdding(false)
  }

  const attachedIds = new Set(attached.map((t) => t.id))
  const unattached = available.filter((t) => !attachedIds.has(t.id))

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {attached.length === 0 && (
            <span className="text-sm text-muted-foreground">{t('empty')}</span>
          )}
          {attached.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
              style={tag.color ? { borderColor: tag.color, color: tag.color } : undefined}
            >
              {tag.name}
              <button
                type="button"
                onClick={() => detach(tag.id)}
                aria-label={t('removeTag', { name: tag.name })}
                className="opacity-60 hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        {unattached.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {unattached.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => attach(tag.id)}
                className="rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
              >
                + {tag.name}
              </button>
            ))}
          </div>
        )}

        {adding ? (
          <form onSubmit={createAndAttach} className="flex items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('newTagPlaceholder')}
              className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
            />
            <Button type="submit" size="sm" disabled={!newName.trim()}>
              {t('create')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              {t('cancel')}
            </Button>
          </form>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('newTag')}
          </Button>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </CardContent>
    </Card>
  )
}
