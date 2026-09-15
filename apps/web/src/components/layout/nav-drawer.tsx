'use client'

import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Menu, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavDrawerProps {
  /**
   * Accessible name for the hamburger trigger. Kept as a plain prop (not a
   * message key) so callers can pass either a translated string or an English
   * fallback without forcing a new entry into the message catalogs.
   */
  label: string
  /** Visually hidden dialog title — required by the Radix dialog a11y contract. */
  title: string
  /** Extra classes for the trigger (callers pass `md:hidden` to keep it mobile-only). */
  triggerClassName?: string
  /** Extra classes for the sliding panel (e.g. a dark surface for the admin panel). */
  contentClassName?: string
  /** Extra classes for the close button, for panels with a dark surface. */
  closeClassName?: string
  /**
   * Render prop — receives `close` so every navigation target inside the drawer
   * can dismiss it (Next.js client-side navigation does not unmount the header).
   */
  children: (close: () => void) => React.ReactNode
}

/**
 * Off-canvas navigation drawer shared by the public header and the admin panel.
 *
 * Built on the Radix dialog primitive that already ships with the app
 * (`@radix-ui/react-dialog`, the dependency behind `components/ui/dialog.tsx`)
 * rather than a new dependency: it gives focus trapping, Escape-to-close,
 * scroll locking and `aria-modal` semantics for free. `components/ui/dialog.tsx`
 * itself is not reused because its `DialogContent` is hard-centered; a drawer
 * needs an edge-anchored panel.
 */
export function NavDrawer({
  label,
  title,
  triggerClassName,
  contentClassName,
  closeClassName,
  children,
}: NavDrawerProps) {
  const [open, setOpen] = React.useState(false)
  const close = React.useCallback(() => setOpen(false), [])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        aria-label={label}
        aria-expanded={open}
        className={cn(
          'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          triggerClassName,
        )}
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          // No description — opt out explicitly so Radix does not warn.
          aria-describedby={undefined}
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-[280px] max-w-[85vw] flex-col overflow-y-auto bg-background shadow-xl duration-200 focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
            contentClassName,
          )}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Close
            aria-label="Close menu"
            className={cn(
              'absolute right-3 top-3 rounded-md p-1 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              closeClassName,
            )}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </DialogPrimitive.Close>
          {children(close)}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
