'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DashboardNavItem {
  /** Path WITHOUT locale prefix, e.g. "/agency/gigs". */
  href: string
  label: string
  icon: LucideIcon
  /** Match only the exact path (use for the dashboard home). */
  exact?: boolean
}

interface DashboardShellProps {
  locale: string
  /** Short role label shown above the menu, e.g. "Freelancer". */
  roleLabel: string
  nav: DashboardNavItem[]
  children: React.ReactNode
}

/**
 * Shared left-sidebar layout for the three role dashboards (candidate, agency, freelancer).
 * Inspired by the Jobtex dashboard pattern; uses the project's own colour tokens.
 */
export function DashboardShell({ locale, roleLabel, nav, children }: DashboardShellProps) {
  const pathname = usePathname() ?? ''
  const base = `/${locale}`
  const isActive = (item: DashboardNavItem) => {
    const full = `${base}${item.href}`
    return item.exact ? pathname === full : pathname === full || pathname.startsWith(`${full}/`)
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:flex-row">
      <aside className="md:w-64 md:shrink-0">
        <nav aria-label={roleLabel} className="rounded-lg border bg-card p-2 md:sticky md:top-20">
          <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {roleLabel}
          </p>
          <ul className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {nav.map((item) => {
              const Icon = item.icon
              const active = isActive(item)
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={`${base}${item.href}`}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground/80 hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className="whitespace-nowrap">{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  )
}
