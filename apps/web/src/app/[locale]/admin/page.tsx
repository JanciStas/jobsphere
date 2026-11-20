import type { Metadata } from 'next'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import {
  Users,
  UserCheck,
  Building2,
  Briefcase,
  UserCog,
  FileText,
  ClipboardList,
  CreditCard,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import { auth } from '@/lib/auth'
import { SHORT_DATE } from '@/lib/formats'
import { AdminKpiCard } from '@/components/admin/kpi-card'
import {
  getAdminKpis,
  getAttentionCounts,
  getRecentAdminActivity,
  getRecentSignups,
} from '@/lib/admin/overview'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return { title: t('adminDashboard.title') }
}

export default async function AdminOverviewPage({ params }: { params: { locale: string } }) {
  // The layout already guards, but a page must never rely on that alone.
  const session = await auth()
  if (!session?.user?.isGlobalAdmin) redirect(`/${params.locale}/login/admin?error=forbidden`)

  const t = await getTranslations('adminCore.overview')
  const format = await getFormatter()
  const base = `/${params.locale}/admin`

  const [kpis, attention, signups, activity] = await Promise.all([
    getAdminKpis(),
    getAttentionCounts(),
    getRecentSignups(),
    getRecentAdminActivity(),
  ])

  const n = (v: number | null) => (v === null ? null : format.number(v))

  const cards = [
    {
      key: 'users',
      value: n(kpis.users),
      icon: Users,
      hint: kpis.newUsers7d === null ? null : t('newUsers', { count: kpis.newUsers7d }),
    },
    { key: 'candidates', value: n(kpis.candidates), icon: UserCheck },
    {
      key: 'employers',
      value: n(kpis.employers),
      icon: Building2,
      hint: kpis.organizations === null ? null : t('companies', { count: kpis.organizations }),
    },
    { key: 'agencies', value: n(kpis.agencies), icon: Briefcase },
    { key: 'freelancers', value: n(kpis.freelancers), icon: UserCog },
    { key: 'activeJobs', value: n(kpis.activeJobs), icon: FileText },
    { key: 'openGigs', value: n(kpis.openGigs), icon: ClipboardList },
    { key: 'activeSubscriptions', value: n(kpis.activeSubscriptions), icon: CreditCard },
  ]

  const alerts = [
    { key: 'unverified', count: attention.unverifiedOld, href: `${base}/users` },
    { key: 'locked', count: attention.locked, href: `${base}/users` },
    { key: 'dsar', count: attention.dsarPending, href: `${base}/gdpr` },
    { key: 'pastDue', count: attention.pastDue, href: `${base}/billing` },
  ].filter((a) => (a.count ?? 0) > 0)
  const attentionFailed = Object.values(attention).every((v) => v === null)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {cards.map((c) => (
          <AdminKpiCard
            key={c.key}
            value={c.value}
            label={t(`kpi.${c.key}`)}
            icon={c.icon}
            hint={c.hint}
          />
        ))}
      </div>

      <section aria-labelledby="attention-title" className="rounded-lg border bg-card p-4">
        <h2 id="attention-title" className="flex items-center gap-2 text-base font-semibold">
          <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
          {t('attention.title')}
        </h2>
        {attentionFailed ? (
          <p className="mt-3 text-sm text-muted-foreground">{t('unavailable')}</p>
        ) : alerts.length === 0 ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            {t('attention.allClear')}
          </p>
        ) : (
          <ul className="mt-3 divide-y">
            {alerts.map((a) => (
              <li key={a.key}>
                <Link
                  href={a.href}
                  className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm hover:text-primary"
                >
                  <span>{t(`attention.${a.key}`, { count: a.count ?? 0 })}</span>
                  <span className="text-xs text-primary">{t('open')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="signups-title" className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 id="signups-title" className="text-base font-semibold">
              {t('recentSignups')}
            </h2>
            <Link href={`${base}/users`} className="text-xs text-primary hover:underline">
              {t('viewAll')}
            </Link>
          </div>
          {signups === null ? (
            <p className="mt-3 text-sm text-muted-foreground">{t('unavailable')}</p>
          ) : signups.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t('noSignups')}</p>
          ) : (
            <ul className="mt-3 divide-y">
              {signups.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <Link
                      href={`${base}/users/${u.id}`}
                      className="block truncate font-medium hover:text-primary"
                    >
                      {u.name || u.email}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {u.name ? `${u.email} · ` : ''}
                      {t(`roles.${u.role}`)}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {format.dateTime(u.createdAt, SHORT_DATE)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="activity-title" className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between">
            <h2 id="activity-title" className="text-base font-semibold">
              {t('recentActivity')}
            </h2>
            <Link href={`${base}/audit`} className="text-xs text-primary hover:underline">
              {t('viewAll')}
            </Link>
          </div>
          {activity === null ? (
            <p className="mt-3 text-sm text-muted-foreground">{t('unavailable')}</p>
          ) : activity.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t('noActivity')}</p>
          ) : (
            <ul className="mt-3 divide-y">
              {activity.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.action}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.actorName ?? '—'}
                      {a.entityType ? ` · ${a.entityType}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {format.dateTime(a.createdAt, SHORT_DATE)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
