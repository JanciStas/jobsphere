'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

export function VisibilityForm({
  locale,
  profileId,
  initialVisible,
}: {
  locale: string
  profileId: string | null
  initialVisible: boolean
}) {
  const t = useTranslations('freelancerDashboard.settings')
  const [visible, setVisible] = useState(initialVisible)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const save = async () => {
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch('/api/freelancer/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visible }),
      })
      if (!res.ok) throw new Error('save failed')
      setMessage(t('saved'))
    } catch {
      setMessage(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={visible}
          onChange={(e) => setVisible(e.target.checked)}
        />
        <span>
          <span className="block font-medium">{t('visibleLabel')}</span>
          <span className="text-muted-foreground">{t('visibleHelp')}</span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? t('saving') : t('save')}
        </Button>
        {profileId && (
          <Button variant="outline" asChild>
            <Link href={`/${locale}/freelancers/${profileId}`}>{t('viewPublic')}</Link>
          </Button>
        )}
        {message && (
          <span role="status" className="text-sm text-muted-foreground">
            {message}
          </span>
        )}
      </div>
    </div>
  )
}
