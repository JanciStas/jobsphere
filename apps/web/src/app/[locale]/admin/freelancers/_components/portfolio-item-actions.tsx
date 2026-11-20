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
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDeleteButton } from '@/components/admin/confirm-delete-button'

interface PortfolioItemActionsProps {
  freelancerId: string
  item: { id: string; title: string; description: string; url: string }
}

/** Moderation of one portfolio item: edit title/description/url, or delete it. */
export function PortfolioItemActions({ freelancerId, item }: PortfolioItemActionsProps) {
  const t = useTranslations('adminMarketplace')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: item.title,
    description: item.description,
    url: item.url,
  })
  const endpoint = `/api/admin/freelancers/${freelancerId}/portfolio/${item.id}`

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || null,
          url: form.url.trim() || null,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? t('common.saveFailed'))
        return
      }
      setOpen(false)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex justify-end gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            {t('common.edit')}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('freelancers.detail.editItem')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div>
              <Label htmlFor={`pi-title-${item.id}`}>{t('freelancers.detail.itemTitle')}</Label>
              <Input
                id={`pi-title-${item.id}`}
                required
                maxLength={150}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor={`pi-desc-${item.id}`}>
                {t('freelancers.detail.itemDescription')}
              </Label>
              <Textarea
                id={`pi-desc-${item.id}`}
                rows={4}
                maxLength={3000}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <Label htmlFor={`pi-url-${item.id}`}>{t('freelancers.detail.itemUrl')}</Label>
              <Input
                id={`pi-url-${item.id}`}
                type="url"
                placeholder="https://…"
                value={form.url}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="submit" disabled={loading}>
                {loading ? t('common.saving') : t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDeleteButton
        endpoint={endpoint}
        triggerLabel={t('common.delete')}
        title={t('freelancers.detail.deleteItemTitle')}
        description={t('freelancers.detail.deleteItemBody', { title: item.title })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        failedLabel={t('common.deleteFailed')}
      />
    </div>
  )
}
