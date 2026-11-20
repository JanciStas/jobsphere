/**
 * Admin User Detail Page (Server Component)
 * Dashboard-style overview of one account: profile, roles and companies,
 * activity, security and the latest audit entries, plus support actions.
 * Re-checks isGlobalAdmin itself and never loads password hashes or tokens.
 */

import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { loadUserDetail } from '@/lib/admin-users/detail'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/dashboard/stat-card'
import { SHORT_DATE_TIME } from '@/lib/formats'
import { RoleBadges, StatusBadge } from '../_components/badges'
import { HelpActions } from '../_components/help-actions'
import { UserDetailActions } from './user-detail-actions'
import {
  ArrowLeft,
  Mail,
  Phone,
  Globe,
  Building2,
  Briefcase,
  FileText,
  Users,
  ClipboardList,
  CheckCircle,
  XCircle,
  ExternalLink,
} from 'lucide-react'

interface PageProps {
  params: { locale: string; id: string }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'adminUsers' })
  return { title: t('detail.metaTitle') }
}

export default async function AdminUserDetailPage({ params }: PageProps) {
  const session = await auth()
  if (!session?.user?.isGlobalAdmin) redirect(`/${params.locale}/login?error=forbidden`)

  const intl = await getFormatter()
  const t = await getTranslations('adminUsers')

  const formatDateTime = (date: string | null): string =>
    date ? intl.dateTime(new Date(date), SHORT_DATE_TIME) : '—'

  const user = await loadUserDetail(params.id)
  if (!user) notFound()

  const isSelf = session.user.id === user.id
  const initials = (user.name ?? user.email)
    .split(/\s+/)
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? '')
    .join('')

  const isEmployer = user.roles.includes('EMPLOYER') || user.roles.includes('AGENCY')

  return (
    <div className="max-w-6xl space-y-6 p-4 md:p-8">
      <Link
        href={`/${params.locale}/admin/users`}
        className="inline-flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('detail.back')}
      </Link>

      {/* Header */}
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            <div
              aria-hidden="true"
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-200 text-xl font-bold text-slate-700"
            >
              {initials || '?'}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <h1 className="text-xl font-bold text-slate-900">
                {user.name ?? <span className="italic text-slate-400">{t('detail.noName')}</span>}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <RoleBadges roles={user.roles} />
                <StatusBadge status={user.status} unverified={!user.security.emailVerified} />
              </div>
              <div className="flex flex-wrap gap-4 text-sm text-slate-500">
                <span className="flex items-center gap-1">
                  <Mail className="h-4 w-4" aria-hidden="true" />
                  {user.email}
                </span>
                {user.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    {user.phone}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Globe className="h-4 w-4" aria-hidden="true" />
                  {user.locale.toUpperCase()} / {user.timezone}
                </span>
              </div>
            </div>
            <UserDetailActions
              userId={user.id}
              isGlobalAdmin={user.isGlobalAdmin}
              isSelf={isSelf}
              locale={params.locale}
            />
          </div>
        </CardContent>
      </Card>

      {/* Activity KPIs, by role */}
      <section aria-label={t('activity.title')} className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {user.hasCandidate && (
          <StatCard
            value={user.activity.applications}
            label={t('activity.applications')}
            icon={FileText}
          />
        )}
        {isEmployer && (
          <>
            <StatCard
              value={user.activity.jobsCreated}
              label={t('activity.jobs')}
              icon={Briefcase}
            />
            <StatCard
              value={user.activity.assignedApplications}
              label={t('activity.assignedApplications')}
              icon={ClipboardList}
            />
          </>
        )}
        {(isEmployer || user.activity.gigsCreated > 0) && (
          <StatCard value={user.activity.gigsCreated} label={t('activity.gigs')} icon={Users} />
        )}
        {user.hasFreelancer && (
          <StatCard value={user.activity.proposals} label={t('activity.proposals')} icon={Users} />
        )}
        {!user.hasCandidate && !isEmployer && !user.hasFreelancer && (
          <p className="col-span-full text-sm italic text-slate-400">{t('activity.none')}</p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Profile */}
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                {t('profile.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label={t('profile.id')} value={user.id} mono />
              <Row label={t('profile.name')} value={user.name ?? '—'} />
              <Row label={t('profile.email')} value={user.email} />
              <Row label={t('profile.phone')} value={user.phone ?? '—'} />
              <Row
                label={t('profile.language')}
                value={`${user.locale.toUpperCase()} / ${user.timezone}`}
              />
              <Row label={t('profile.registered')} value={formatDateTime(user.createdAt)} />
            </CardContent>
          </Card>

          {/* Roles and companies */}
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                {t('memberships.title', { count: user.memberships.length })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {user.memberships.length === 0 ? (
                <p className="text-sm italic text-slate-400">{t('memberships.none')}</p>
              ) : (
                <ul className="space-y-3">
                  {user.memberships.map((m) => (
                    <li
                      key={m.orgId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Building2 className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{m.orgName}</p>
                          <p className="truncate text-xs text-slate-400">
                            {m.role} · {formatDateTime(m.joinedAt)}
                          </p>
                        </div>
                      </div>
                      <Link
                        href={`/${params.locale}/admin/organizations/${m.orgId}`}
                        className="inline-flex shrink-0 items-center gap-1 text-xs text-blue-600 hover:underline"
                      >
                        {t('memberships.manage')}
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Audit */}
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                {t('audit.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {user.audit.length === 0 ? (
                <p className="px-6 py-6 text-sm italic text-slate-400">{t('audit.none')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                        <th scope="col" className="px-6 py-3">
                          {t('audit.action')}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t('audit.direction')}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t('audit.time')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {user.audit.map((log) => (
                        <tr key={log.id}>
                          <td className="px-6 py-3 font-mono text-xs text-slate-700">
                            {log.action}
                          </td>
                          <td className="px-6 py-3 text-xs text-slate-500">
                            {log.direction === 'on'
                              ? t('audit.on', { actor: log.actor ?? '—' })
                              : t('audit.by')}
                          </td>
                          <td className="whitespace-nowrap px-6 py-3 text-xs text-slate-500">
                            {formatDateTime(log.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Security */}
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                {t('security.title')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row
                label={t('security.emailVerified')}
                value={
                  user.security.emailVerified ? (
                    <span className="flex items-center gap-1 text-emerald-600">
                      <CheckCircle className="h-4 w-4" aria-hidden="true" />
                      {formatDateTime(user.security.emailVerified)}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-red-500">
                      <XCircle className="h-4 w-4" aria-hidden="true" />
                      {t('security.no')}
                    </span>
                  )
                }
              />
              <Row
                label={t('security.twoFactor')}
                value={user.security.totpEnabled ? t('security.yes') : t('security.no')}
              />
              <Row
                label={t('security.failedAttempts')}
                value={String(user.security.failedAttempts)}
              />
              {user.status !== 'ACTIVE' && (
                <Row
                  label={t(
                    user.status === 'SUSPENDED' ? 'security.suspended' : 'security.lockedUntil',
                  )}
                  value={
                    user.status === 'SUSPENDED'
                      ? t('status.SUSPENDED')
                      : formatDateTime(user.lockedUntil)
                  }
                  className="text-red-600"
                />
              )}
              <Row
                label={t('security.lastLogin')}
                value={formatDateTime(user.security.lastLoginAt)}
              />
              <Row
                label={t('security.lastLoginIp')}
                value={user.security.lastLoginIp ?? '—'}
                mono
              />
            </CardContent>
          </Card>

          {/* Help actions */}
          <Card className="border border-slate-200 bg-white shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-slate-700">
                {t('actions.title')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <HelpActions
                userId={user.id}
                name={user.name}
                email={user.email}
                phone={user.phone}
                emailVerified={user.security.emailVerified !== null}
                status={user.status}
                isGlobalAdmin={user.isGlobalAdmin}
                isSelf={isSelf}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  mono = false,
  className = '',
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
  className?: string
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span
        className={`break-all text-right text-slate-800 ${mono ? 'font-mono text-xs' : ''} ${className}`}
      >
        {value}
      </span>
    </div>
  )
}
