'use client'

/**
 * UserDetailActions — Client Component
 * Admin-role and delete buttons for the user detail page. Suspend/restore and the
 * other support actions live in ../_components/help-actions.tsx (with confirmation).
 */

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { ShieldCheck, ShieldOff, Trash2, Loader2 } from 'lucide-react'

interface UserDetailActionsProps {
  userId: string
  isGlobalAdmin: boolean
  isSelf: boolean
  locale: string
}

type Action = 'promote_admin' | 'demote_admin'

export function UserDetailActions({
  userId,
  isGlobalAdmin,
  isSelf,
  locale,
}: UserDetailActionsProps) {
  const router = useRouter()
  const t = useTranslations('admin')
  const [pending, setPending] = useState<Action | 'delete' | null>(null)
  const [toast, setToast] = useState<{ message: string; ok: boolean } | null>(null)

  function showToast(message: string, ok: boolean) {
    setToast({ message, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function performAction(action: Action) {
    setPending(action)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action }),
      })
      const data: { error?: string } = await res.json()
      if (!res.ok) {
        showToast(data.error ?? t('common.actionFailed'), false)
        return
      }
      showToast(t('common.actionSuccess'), true)
      router.refresh()
    } catch {
      showToast(t('common.actionError'), false)
    } finally {
      setPending(null)
    }
  }

  async function performDelete() {
    setPending('delete')
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
      const data: { error?: string } = await res.json()
      if (!res.ok) {
        showToast(data.error ?? t('users.detail.deleteFailed'), false)
        return
      }
      router.push(`/${locale}/admin/users`)
    } catch {
      showToast(t('users.detail.deleteError'), false)
    } finally {
      setPending(null)
    }
  }

  const isLoading = pending !== null

  return (
    <>
      {/* Toast */}
      {toast && (
        <div
          className={`fixed right-4 top-4 z-50 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            toast.ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}

      <div className="flex shrink-0 flex-wrap gap-2">
        {/* Promote / Demote admin */}
        {isGlobalAdmin ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isLoading || isSelf}
            onClick={() => performAction('demote_admin')}
            className="border-amber-200 text-amber-600 hover:bg-amber-50"
          >
            {pending === 'demote_admin' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldOff className="mr-2 h-4 w-4" />
            )}
            {t('users.demote')}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={isLoading}
            onClick={() => performAction('promote_admin')}
          >
            {pending === 'promote_admin' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 h-4 w-4" />
            )}
            {t('users.promote')}
          </Button>
        )}

        {/* Soft Delete */}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading || isSelf || isGlobalAdmin}
              className="border-red-200 text-red-600 hover:bg-red-50"
            >
              {pending === 'delete' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {t('common.delete')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('users.detail.deleteTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('users.detail.deleteDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={performDelete}
                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              >
                {t('common.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </>
  )
}
