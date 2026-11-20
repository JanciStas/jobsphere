'use client'

import { useTranslations } from 'next-intl'
import { LayoutDashboard, FileText, ScrollText, Heart, User } from 'lucide-react'
import { DashboardShell, type DashboardNavItem } from '@/components/dashboard/dashboard-shell'

/** Client wrapper: icons are components, so the nav must be built on the client side. */
export function CandidateShell({
  locale,
  children,
}: {
  locale: string
  children: React.ReactNode
}) {
  const t = useTranslations('candidateDashboard')
  const nav: DashboardNavItem[] = [
    { href: '/dashboard', label: t('nav.overview'), icon: LayoutDashboard, exact: true },
    { href: '/dashboard/applications', label: t('nav.applications'), icon: FileText },
    { href: '/dashboard/cv', label: t('nav.cv'), icon: ScrollText },
    { href: '/dashboard/saved', label: t('nav.saved'), icon: Heart },
    { href: '/dashboard/profile', label: t('nav.profile'), icon: User },
  ]
  return (
    <DashboardShell locale={locale} roleLabel={t('roleLabel')} nav={nav}>
      {children}
    </DashboardShell>
  )
}
