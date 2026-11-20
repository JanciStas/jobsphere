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
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-4 py-6 md:flex-row md:gap-8 md:px-6 md:py-8 lg:px-8">
      <aside className="md:w-72 md:shrink-0">
        <nav
          aria-label={roleLabel}
          className="rounded-xl border bg-card p-3 shadow-sm md:sticky md:top-24"
        >
          <p className="px-3 pb-3 pt-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
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
                      'flex min-h-12 items-center gap-3 rounded-lg px-4 py-3 text-base font-medium transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-foreground/80 hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    <span className="whitespace-nowrap">{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>
      <div className="min-w-0 flex-1 text-base [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight md:[&_h1]:text-4xl [&_input]:min-h-12 [&_input]:text-base [&_select]:min-h-12 [&_select]:text-base [&_textarea]:text-base">
        {children}
      </div>
    </div>
  )
}
