'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

/** Accept / reject a pending proposal through the existing PATCH proposals API. */
export function ProposalActions({ gigId, proposalId }: { gigId: string; proposalId: string }) {
  const t = useTranslations('agencyDashboard')
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const decide = async (action: 'ACCEPT' | 'REJECT') => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/gigs/${gigId}/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        setError(t('gigs.failed'))
        return
      }
      router.refresh()
    } catch {
      setError(t('gigs.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" disabled={busy} onClick={() => decide('ACCEPT')}>
        {t('gigDetail.accept')}
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => decide('REJECT')}>
        {t('gigDetail.reject')}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
