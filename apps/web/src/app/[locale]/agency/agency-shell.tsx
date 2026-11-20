'use client'

import { useTranslations } from 'next-intl'
import { LayoutDashboard, Briefcase, PlusCircle, Inbox, Users, Settings } from 'lucide-react'
import { DashboardShell, type DashboardNavItem } from '@/components/dashboard/dashboard-shell'

/** Client wrapper: icons are components, so the nav must be built on the client side. */
export function AgencyShell({ locale, children }: { locale: string; children: React.ReactNode }) {
  const t = useTranslations('agencyDashboard')
  const nav: DashboardNavItem[] = [
    { href: '/agency/dashboard', label: t('nav.overview'), icon: LayoutDashboard, exact: true },
    { href: '/agency/gigs', label: t('nav.gigs'), icon: Briefcase, exact: true },
    { href: '/agency/gigs/new', label: t('nav.newGig'), icon: PlusCircle, exact: true },
    { href: '/agency/proposals', label: t('nav.proposals'), icon: Inbox },
    { href: '/freelancers', label: t('nav.freelancers'), icon: Users },
    { href: '/agency/settings', label: t('nav.settings'), icon: Settings },
  ]
  return (
    <DashboardShell locale={locale} roleLabel={t('roleLabel')} nav={nav}>
      {children}
    </DashboardShell>
  )
}
