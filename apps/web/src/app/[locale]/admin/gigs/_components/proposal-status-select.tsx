'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

const STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const

interface ProposalStatusSelectProps {
  gigId: string
  proposalId: string
  currentStatus: string
  /** Another proposal of this gig is already ACCEPTED, so ACCEPTED is disabled here. */
  otherAccepted: boolean
}

/** Admin override of a proposal status (max one ACCEPTED per gig, enforced by the API too). */
export function ProposalStatusSelect({
  gigId,
  proposalId,
  currentStatus,
  otherAccepted,
}: ProposalStatusSelectProps) {
  const t = useTranslations('adminMarketplace')
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(status: string) {
    if (status === currentStatus) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/gigs/${gigId}/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
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

  return (
    <div className="flex flex-col items-end gap-1">
      <select
        value={currentStatus}
        disabled={loading}
        onChange={(e) => change(e.target.value)}
        aria-label={t('gigs.detail.changeStatus')}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s} disabled={s === 'ACCEPTED' && otherAccepted}>
            {t(`proposalStatusLabels.${s}`)}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
