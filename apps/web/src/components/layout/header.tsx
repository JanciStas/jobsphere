'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useSession, signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { LanguageSwitcher } from './language-switcher'
import { NotificationBell } from './notification-bell'
import { NavDrawer } from './nav-drawer'

type AccountRole = 'admin' | 'agency' | 'employer' | 'freelancer' | 'candidate'

interface AccountInfo {
  role: AccountRole
  dashboardHref: string
  settingsHref: string
}

/** Derives the account's single role (and where its dashboard/settings live) from the session. */
export function describeAccount(
  user:
    | {
        role?: string
        orgId?: string
        isGlobalAdmin?: boolean
        isFreelancer?: boolean
      }
    | undefined,
  locale: string,
): AccountInfo {
  const base = `/${locale}`
  if (user?.isGlobalAdmin) {
    return { role: 'admin', dashboardHref: `${base}/admin`, settingsHref: `${base}/admin/settings` }
  }
  if (user?.role === 'AGENCY') {
    return {
      role: 'agency',
      dashboardHref: `${base}/agency/dashboard`,
      settingsHref: `${base}/agency/settings`,
    }
  }
  if (user?.orgId) {
    return {
      role: 'employer',
      dashboardHref: `${base}/employer`,
      settingsHref: `${base}/employer/settings`,
    }
  }
  if (user?.isFreelancer) {
    return {
      role: 'freelancer',
      dashboardHref: `${base}/freelancer/dashboard`,
      settingsHref: `${base}/freelancer/profile`,
    }
  }
  return {
    role: 'candidate',
    dashboardHref: `${base}/dashboard`,
    settingsHref: `${base}/dashboard/profile`,
  }
}

export function Header() {
  const t = useTranslations()
  const pathname = usePathname()
  const locale = pathname.split('/')[1] || 'en'
  const { data: session, status } = useSession()

  // One clear identity per signed-in user: the role decides the dashboard and the label.
  const account = describeAccount(session?.user, locale)

  const navItems = [
    { href: `/${locale}`, label: t('nav.home') },
    { href: `/${locale}/jobs`, label: t('nav.jobs') },
    { href: `/${locale}/companies`, label: t('nav.companies') },
    { href: `/${locale}/freelancers`, label: t('nav.freelancers') },
    { href: `/${locale}/gigs`, label: t('nav.gigs') },
    { href: `/${locale}/for-employers`, label: t('nav.forEmployers') },
    { href: `/${locale}/pricing`, label: t('nav.pricing') },
  ]

  return (
    <header
      className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60"
      role="banner"
      aria-label={t('nav.siteHeader')}
    >
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-3 lg:gap-8">
          {/* Below md the desktop <nav> is display:none, so this drawer is the
              ONLY way to reach the main navigation. It renders the very same
              `navItems` array — the list is defined once, above. */}
          <NavDrawer
            label={t('nav.openMenu')}
            title={t('nav.mainNavigation')}
            triggerClassName="lg:hidden"
          >
            {(close) => (
              <nav
                className="flex flex-col gap-1 px-3 pb-6 pt-16"
                role="navigation"
                aria-label={t('nav.mobileNavigation')}
              >
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    className="rounded-md px-3 py-2.5 text-base font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-primary aria-[current=page]:text-primary"
                    aria-current={pathname === item.href ? 'page' : undefined}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}
          </NavDrawer>

          <Link href={`/${locale}`} className="flex items-center" aria-label={t('nav.homeAria')}>
            <Image
              src="/images/jobsphere_logo.png"
              alt="JobSphere"
              width={120}
              height={40}
              className="h-10 w-auto"
              priority
            />
          </Link>

          <nav
            className="hidden items-center gap-4 lg:flex xl:gap-6"
            role="navigation"
            aria-label={t('nav.mainNavigation')}
          >
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
                aria-current={pathname === item.href ? 'page' : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div
          className="flex items-center gap-2 lg:gap-4"
          role="navigation"
          aria-label={t('nav.userActions')}
        >
          <LanguageSwitcher />
          {/* Only for signed-in users: the endpoint is per-user and there is
              nothing to show an anonymous visitor. */}
          {session?.user && <NotificationBell locale={locale} />}
          {status === 'loading' ? (
            <Button variant="ghost" size="sm" disabled>
              {t('nav.loading')}
            </Button>
          ) : session?.user ? (
            <>
              <Button size="sm" variant="outline" className="hidden xl:inline-flex" asChild>
                <Link href={account.dashboardHref}>{t('nav.myDashboard')}</Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="h-11 gap-2 px-2">
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                    >
                      {(session.user.name || session.user.email || '?').charAt(0).toUpperCase()}
                    </span>
                    <span className="hidden max-w-[11rem] flex-col items-start text-left leading-tight sm:flex">
                      <span className="w-full truncate text-sm font-medium">
                        {session.user.name || session.user.email || t('nav.account')}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t(`nav.roles.${account.role}`)}
                      </span>
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="font-normal">
                    <p className="truncate text-sm font-semibold">
                      {session.user.name || t('nav.account')}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
                    <p className="mt-1 text-xs font-medium text-primary">
                      {t(`nav.roles.${account.role}`)}
                    </p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild className="min-h-11 text-base">
                    <Link href={account.dashboardHref}>{t('nav.myDashboard')}</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="min-h-11 text-base">
                    <Link href={account.settingsHref}>{t('nav.accountSettings')}</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="min-h-11 text-base"
                    onClick={() => signOut({ callbackUrl: `/${locale}` })}
                  >
                    {t('nav.logout')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/${locale}/login`}>{t('nav.login')}</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href={`/${locale}/signup`}>{t('nav.signup')}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
