'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge } from '../_lib/status-badge'

export interface AgencyGigRow {
  id: string
  title: string
  budget: number | null
  currency: string
  durationDays: number | null
  status: string
  proposalCount: number
}

const STATUSES = ['OPEN', 'IN_PROGRESS', 'CLOSED'] as const

export function AgencyGigsList({ locale, gigs }: { locale: string; gigs: AgencyGigRow[] }) {
  const t = useTranslations('agencyDashboard')
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const call = async (id: string, init: RequestInit) => {
    setBusyId(id)
    setError('')
    try {
      const res = await fetch(`/api/gigs/${id}`, {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        setError(t('gigs.failed'))
        return
      }
      setConfirmId(null)
      router.refresh()
    } catch {
      setError(t('gigs.failed'))
    } finally {
      setBusyId(null)
    }
  }

  if (gigs.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-4 py-10 text-center">
          <p className="text-muted-foreground">{t('gigs.empty')}</p>
          <Button asChild>
            <Link href={`/${locale}/agency/gigs/new`}>{t('gigs.createFirst')}</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {gigs.map((gig) => (
        <Card key={gig.id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  href={`/${locale}/agency/gigs/${gig.id}`}
                  className="text-lg font-semibold hover:underline"
                >
                  {gig.title}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {gig.budget != null && `${gig.budget} ${gig.currency} · `}
                  {gig.durationDays != null &&
                    `${t('common.days', { count: gig.durationDays })} · `}
                  {t('gigs.proposalsCount', { count: gig.proposalCount })}
                </p>
              </div>
              <StatusBadge status={gig.status} label={t(`status.${gig.status}`)} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`status-${gig.id}`}>
                {t('gigs.changeStatus')}
              </label>
              <select
                id={`status-${gig.id}`}
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={gig.status}
                disabled={busyId === gig.id}
                onChange={(e) =>
                  call(gig.id, {
                    method: 'PATCH',
                    body: JSON.stringify({ status: e.target.value }),
                  })
                }
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/${locale}/agency/gigs/${gig.id}`}>{t('gigs.detail')}</Link>
              </Button>
              {confirmId === gig.id ? (
                <span className="flex items-center gap-2 text-sm">
                  <span>{t('gigs.deleteConfirm')}</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={busyId === gig.id}
                    onClick={() => call(gig.id, { method: 'DELETE' })}
                  >
                    {t('gigs.deleteYes')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                    {t('common.cancel')}
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setConfirmId(gig.id)}
                >
                  {t('gigs.delete')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
