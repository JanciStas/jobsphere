'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

export function WithdrawButton({ proposalId }: { proposalId: string }) {
  const t = useTranslations('freelancerDashboard.proposals')
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const withdraw = async () => {
    if (!window.confirm(t('withdrawConfirm'))) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/freelancer/proposals/${proposalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'WITHDRAW' }),
      })
      if (!res.ok) throw new Error('failed')
      router.refresh()
    } catch {
      setError(t('withdrawFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={withdraw} disabled={busy}>
        {t('withdraw')}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </>
  )
}
