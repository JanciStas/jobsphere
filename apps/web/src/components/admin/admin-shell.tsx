'use client'

import { useTranslations } from 'next-intl'
import {
  LayoutDashboard,
  Users,
  Building2,
  UserCog,
  ClipboardList,
  Briefcase,
  CreditCard,
  ScrollText,
  ShieldCheck,
  FileWarning,
  Settings,
  FileText,
  type LucideIcon,
} from 'lucide-react'
import { DashboardShell } from '@/components/dashboard/dashboard-shell'

export interface AdminNavItem {
  /** Key inside the `adminCore.nav` namespace. */
  key: string
  /** Path WITHOUT locale prefix. */
  href: string
  icon: LucideIcon
  /** Match only the exact path (overview). */
  exact?: boolean
  /** Extra path prefixes (without locale) that also mark this item active. */
  alsoActive?: string[]
}

export const ADMIN_NAV: AdminNavItem[] = [
  { key: 'overview', href: '/admin', icon: LayoutDashboard, exact: true },
  { key: 'users', href: '/admin/users', icon: Users },
  { key: 'organizations', href: '/admin/organizations', icon: Building2 },
  { key: 'freelancers', href: '/admin/freelancers', icon: UserCog },
  { key: 'gigs', href: '/admin/gigs', icon: ClipboardList },
  { key: 'jobs', href: '/admin/jobs', icon: Briefcase },
  {
    key: 'billing',
    href: '/admin/billing',
    icon: CreditCard,
    alsoActive: ['/admin/subscriptions'],
  },
  { key: 'audit', href: '/admin/audit', icon: ScrollText },
  { key: 'team', href: '/admin/team', icon: ShieldCheck },
  { key: 'gdpr', href: '/admin/gdpr', icon: FileWarning },
  { key: 'content', href: '/admin/content', icon: FileText },
  { key: 'settings', href: '/admin/settings', icon: Settings },
]

/** Pure helper (unit-tested): is `item` the active entry for this pathname? */
export function isAdminNavActive(item: AdminNavItem, pathname: string, locale: string): boolean {
  const matches = (path: string, exact?: boolean) => {
    const full = `/${locale}${path}`
    return exact ? pathname === full : pathname === full || pathname.startsWith(`${full}/`)
  }
  return matches(item.href, item.exact) || (item.alsoActive ?? []).some((p) => matches(p))
}

interface AdminShellProps {
  locale: string
  children: React.ReactNode
}

/** Super-admin layout, built on the shared DashboardShell so it matches the role dashboards. */
export function AdminShell({ locale, children }: AdminShellProps) {
  const t = useTranslations('adminCore.nav')
  const nav = ADMIN_NAV.map((item) => ({
    href: item.href,
    label: t(item.key),
    icon: item.icon,
    exact: item.exact,
  }))
  return (
    <DashboardShell locale={locale} roleLabel={t('panelTitle')} nav={nav}>
      {children}
    </DashboardShell>
  )
}
