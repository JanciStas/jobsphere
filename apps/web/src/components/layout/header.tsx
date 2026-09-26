'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
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

export function Header() {
  const t = useTranslations()
  const pathname = usePathname()
  const router = useRouter()
  const locale = pathname.split('/')[1] || 'en'
  const { data: session, status, update } = useSession()

  // PR7 dual-role context switch: persist the chosen org into the JWT (server
  // re-derives role/orgId), then route into the employer workspace. switch-authz
  // is enforced server-side in the jwt callback — a foreign orgId is ignored.
  async function switchToOrg(orgId: string) {
    await update({ activeOrgId: orgId })
    router.push(`/${locale}/employer`)
  }

  const orgs = session?.user?.orgs ?? []
  const activeOrgId = session?.user?.activeOrgId

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
      aria-label="Site header"
    >
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-3 lg:gap-8">
          {/* Below md the desktop <nav> is display:none, so this drawer is the
              ONLY way to reach the main navigation. It renders the very same
              `navItems` array — the list is defined once, above. */}
          <NavDrawer label="Open main menu" title="Main navigation" triggerClassName="lg:hidden">
            {(close) => (
              <nav
                className="flex flex-col gap-1 px-3 pb-6 pt-16"
                role="navigation"
                aria-label="Mobile navigation"
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

          <Link href={`/${locale}`} className="flex items-center" aria-label="JobSphere home">
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
            className="hidden items-center gap-6 lg:flex"
            role="navigation"
            aria-label="Main navigation"
          >
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
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
          aria-label="User actions"
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  {session.user.name || session.user.email || 'Account'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {orgs.length > 0 && (
                  <>
                    <DropdownMenuLabel>Kontext</DropdownMenuLabel>
                    {orgs.map((org) => (
                      <DropdownMenuItem key={org.orgId} onClick={() => switchToOrg(org.orgId)}>
                        <span className="mr-2 w-3">{org.orgId === activeOrgId ? '✓' : ''}</span>
                        {org.orgName || 'Firma'}
                      </DropdownMenuItem>
                    ))}
                    {/* MVP: personal contexts are a plain redirect (no active-org
                        change) — the candidate context has no org. */}
                    <DropdownMenuItem asChild>
                      <Link href={`/${locale}/dashboard`}>Ako uchádzač</Link>
                    </DropdownMenuItem>
                    {session.user.isFreelancer && (
                      <DropdownMenuItem asChild>
                        <Link href={`/${locale}/freelancers`}>Ako freelancer</Link>
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem asChild>
                  <Link href={session.user.orgId ? `/${locale}/employer` : `/${locale}/dashboard`}>
                    {t('nav.dashboard')}
                  </Link>
                </DropdownMenuItem>
                {session.user.orgId && (
                  <DropdownMenuItem asChild>
                    <Link href={`/${locale}/employer/settings`}>Nastavenia spoločnosti</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link href={`/${locale}/dashboard/profile`}>{t('nav.profile')}</Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut({ callbackUrl: `/${locale}` })}>
                  {t('nav.logout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/${locale}/login`} aria-label="Log in to your account">
                  {t('nav.login')}
                </Link>
              </Button>
              <Button size="sm" asChild>
                <Link href={`/${locale}/signup`} aria-label="Create a new account">
                  {t('nav.signup')}
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
