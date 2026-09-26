'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface EditOrgDialogProps {
  orgId: string
  slug: string
  name: string
  industry: string | null
  size: string | null
  website: string | null
}

/**
 * Editing an organisation from the admin panel.
 *
 * There was no way to do this at all: an organisation could be created and
 * suspended, and nothing else, through any route or any screen. A typo in a
 * company name was permanent.
 *
 * Slug is shown read-only rather than omitted, so it is obvious that it exists
 * and is deliberately not editable — it appears in the public company URL, and
 * changing it would break every link already pointing at that profile.
 *
 * Follows SettingEditDialog: inline error text, `alert` nowhere, and
 * router.refresh() on success. The admin panel has no toast.
 */
export function EditOrgDialog({ orgId, slug, name, industry, size, website }: EditOrgDialogProps) {
  const router = useRouter()
  const t = useTranslations('miscEditOrg')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name,
    industry: industry ?? '',
    size: size ?? '',
    website: website ?? '',
  })

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/organizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update',
          orgId,
          name: form.name.trim(),
          // Empty strings clear the field rather than storing "". The API takes
          // null for all three.
          industry: form.industry.trim() || null,
          size: form.size.trim() || null,
          website: form.website.trim() || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? t('saveFailed'))
        return
      }
      setOpen(false)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t('edit')}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <Label>Slug</Label>
            <p className="mt-0.5 font-mono text-sm text-muted-foreground">{slug}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('slugLocked')}</p>
          </div>
          <div>
            <Label htmlFor="org-name">{t('name')}</Label>
            <Input
              id="org-name"
              autoFocus
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="org-industry">{t('industry')}</Label>
            <Input
              id="org-industry"
              value={form.industry}
              onChange={(e) => update('industry', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="org-size">{t('size')}</Label>
            <Input
              id="org-size"
              value={form.size}
              onChange={(e) => update('size', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="org-website">{t('website')}</Label>
            <Input
              id="org-website"
              type="url"
              placeholder="https://…"
              value={form.website}
              onChange={(e) => update('website', e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => setOpen(false)}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={loading || !form.name.trim()}>
              {loading ? t('saving') : t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
