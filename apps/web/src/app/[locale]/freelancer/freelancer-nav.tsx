'use client'

import { useTranslations } from 'next-intl'
import {
  Briefcase,
  GalleryHorizontal,
  LayoutDashboard,
  Send,
  Settings,
  UserRound,
} from 'lucide-react'
import { DashboardShell, type DashboardNavItem } from '@/components/dashboard/dashboard-shell'

/** Client wrapper: icon components cannot cross the server -> client boundary as props. */
export function FreelancerNav({ locale, children }: { locale: string; children: React.ReactNode }) {
  const t = useTranslations('freelancerDashboard')

  const nav: DashboardNavItem[] = [
    { href: '/freelancer/dashboard', label: t('nav.overview'), icon: LayoutDashboard, exact: true },
    { href: '/freelancer/profile', label: t('nav.profile'), icon: UserRound },
    { href: '/freelancer/portfolio', label: t('nav.portfolio'), icon: GalleryHorizontal },
    { href: '/gigs', label: t('nav.gigs'), icon: Briefcase },
    { href: '/freelancer/proposals', label: t('nav.proposals'), icon: Send },
    { href: '/freelancer/settings', label: t('nav.settings'), icon: Settings },
  ]

  return (
    <DashboardShell locale={locale} roleLabel={t('roleLabel')} nav={nav}>
      {children}
    </DashboardShell>
  )
}
