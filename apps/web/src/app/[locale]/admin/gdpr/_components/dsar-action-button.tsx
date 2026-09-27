'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

type DsarAction = 'EXECUTE_DELETE' | 'MARK_COMPLETED' | 'REJECT'

/**
 * Follows the OrgActionButton pattern in admin/organizations/_components: plain
 * `alert()` on failure and `router.refresh()` on success. The admin panel uses
 * neither sonner nor a shared toast, and this is not the place to introduce a
 * fourth convention.
 */
export function DsarActionButton({
  requestId,
  action,
  label,
  variant = 'outline',
}: {
  requestId: string
  action: DsarAction
  label: string
  variant?: 'outline' | 'destructive' | 'default'
}) {
  const router = useRouter()
  const t = useTranslations('adminGdpr')
  const [loading, setLoading] = useState(false)

  async function run() {
    // Erasure is irreversible and hard-deletes another person's data. The one
    // action that cannot be undone gets the one confirmation.
    if (action === 'EXECUTE_DELETE' && !confirm(t('confirmDelete'))) {
      return
    }

    let rejectionReason: string | undefined
    if (action === 'REJECT') {
      const reason = prompt(t('rejectPrompt'))
      if (reason === null) return
      rejectionReason = reason || undefined
    }

    setLoading(true)
    try {
      const res = await fetch(`/api/admin/gdpr/dsar/${requestId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(rejectionReason && { rejectionReason }) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error ?? t('error'))
        return
      }
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant={variant} size="sm" disabled={loading} onClick={run}>
      {loading ? t('working') : label}
    </Button>
  )
}
