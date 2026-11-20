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

interface EditJobDialogProps {
  job: {
    id: string
    title: string
    description: string
    city: string | null
    salaryMin: number | null
    salaryMax: number | null
    salaryCurrency: string
    status: string
    deleted: boolean
  }
}

const toIntOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

/**
 * Admin editing of a job posting: content, close/archive, soft-delete and
 * restore. All writes go through PATCH /api/admin/jobs (audited server-side).
 */
export function EditJobDialog({ job }: EditJobDialogProps) {
  const t = useTranslations('adminMarketplace')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: job.title,
    description: job.description,
    city: job.city ?? '',
    salaryMin: job.salaryMin?.toString() ?? '',
    salaryMax: job.salaryMax?.toString() ?? '',
    salaryCurrency: job.salaryCurrency,
  })

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/jobs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          title: form.title.trim(),
          description: form.description.trim(),
          city: form.city.trim() || null,
          salaryMin: toIntOrNull(form.salaryMin),
          salaryMax: toIntOrNull(form.salaryMax),
          salaryCurrency: form.salaryCurrency.trim() || 'EUR',
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

  async function restore() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/jobs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id, deleted: false }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? t('common.saveFailed'))
        return
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  const common = {
    endpoint: '/api/admin/jobs',
    method: 'PATCH' as const,
    cancelLabel: t('common.cancel'),
    failedLabel: t('common.saveFailed'),
  }

  if (job.deleted) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button variant="outline" size="sm" disabled={loading} onClick={restore}>
          {t('jobs.restore')}
        </Button>
        {error && (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex justify-end gap-2">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            {t('common.edit')}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('jobs.editTitle')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div>
              <Label htmlFor={`job-title-${job.id}`}>{t('jobs.titleField')}</Label>
              <Input
                id={`job-title-${job.id}`}
                required
                minLength={3}
                maxLength={200}
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`job-desc-${job.id}`}>{t('jobs.description')}</Label>
              <Textarea
                id={`job-desc-${job.id}`}
                required
                minLength={50}
                rows={8}
                maxLength={10000}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor={`job-city-${job.id}`}>{t('jobs.location')}</Label>
              <Input
                id={`job-city-${job.id}`}
                maxLength={100}
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor={`job-smin-${job.id}`}>{t('jobs.salaryMin')}</Label>
                <Input
                  id={`job-smin-${job.id}`}
                  type="number"
                  min={0}
                  value={form.salaryMin}
                  onChange={(e) => set('salaryMin', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`job-smax-${job.id}`}>{t('jobs.salaryMax')}</Label>
                <Input
                  id={`job-smax-${job.id}`}
                  type="number"
                  min={0}
                  value={form.salaryMax}
                  onChange={(e) => set('salaryMax', e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`job-cur-${job.id}`}>{t('jobs.currency')}</Label>
                <Input
                  id={`job-cur-${job.id}`}
                  maxLength={10}
                  value={form.salaryCurrency}
                  onChange={(e) => set('salaryCurrency', e.target.value.toUpperCase())}
                />
              </div>
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
      {job.status !== 'CLOSED' && (
        <ConfirmDeleteButton
          {...common}
          body={{ jobId: job.id, status: 'CLOSED' }}
          triggerLabel={t('jobs.close')}
          title={t('jobs.closeTitle')}
          description={t('jobs.closeBody', { title: job.title })}
          confirmLabel={t('jobs.close')}
        />
      )}
      <ConfirmDeleteButton
        {...common}
        body={{ jobId: job.id, deleted: true }}
        triggerLabel={t('common.delete')}
        title={t('jobs.deleteTitle')}
        description={t('jobs.deleteBody', { title: job.title })}
        confirmLabel={t('common.delete')}
      />
    </div>
  )
}
