'use client'

import { useState } from 'react'
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

interface ConfirmDeleteButtonProps {
  /** API endpoint that accepts the request below. */
  endpoint: string
  method?: 'DELETE' | 'PATCH'
  body?: unknown
  /** Where to go after success; default is a refresh of the current page. */
  redirectTo?: string
  triggerLabel: string
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  failedLabel: string
}

/** Destructive admin action behind an explicit confirmation dialog. */
export function ConfirmDeleteButton({
  endpoint,
  method = 'DELETE',
  body,
  redirectTo,
  triggerLabel,
  title,
  description,
  confirmLabel,
  cancelLabel,
  failedLabel,
}: ConfirmDeleteButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(event: React.MouseEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? failedLabel)
        return
      }
      setOpen(false)
      if (redirectTo) router.push(redirectTo)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction onClick={run} disabled={loading}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
