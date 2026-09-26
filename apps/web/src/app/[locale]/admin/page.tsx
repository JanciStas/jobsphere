import type { Metadata } from 'next'
import { getFormatter, getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Users, Building2, Briefcase, CreditCard } from 'lucide-react'
import { SHORT_DATE } from '@/lib/formats'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('adminDashboard.title'),
  }
}

export default async function AdminDashboardPage() {
  const format = await getFormatter()
  const t = await getTranslations('admin')
  const [totalUsers, totalOrgs, totalJobs, totalApplications, recentUsers, activeSubscriptions] =
    await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.organization.count({ where: { deletedAt: null } }),
      prisma.job.count({ where: { deletedAt: null } }),
      prisma.application.count({ where: { deletedAt: null } }),
      prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          isGlobalAdmin: true,
        },
      }),
      prisma.subscription.count({
        where: { status: { in: ['ACTIVE', 'TRIALING'] } },
      }),
    ])

  const stats = [
    {
      label: t('dashboard.stats.users'),
      value: totalUsers,
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      label: t('dashboard.stats.organizations'),
      value: totalOrgs,
      icon: Building2,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: t('dashboard.stats.jobs'),
      value: totalJobs,
      icon: Briefcase,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
    },
    {
      label: t('dashboard.stats.activeSubscriptions'),
      value: activeSubscriptions,
      icon: CreditCard,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
  ]

  return (
    <div className="space-y-8 p-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('dashboard.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('dashboard.subtitle')}</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.label} className="border border-slate-200 bg-white shadow-sm">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                    <p className="mt-2 text-3xl font-bold text-slate-900">
                      {format.number(stat.value)}
                    </p>
                  </div>
                  <div
                    className={`flex h-12 w-12 items-center justify-center rounded-xl ${stat.bg}`}
                  >
                    <Icon className={`h-6 w-6 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Recent users table */}
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-900">
            {t('dashboard.recentSignups')}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recentUsers.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-500">{t('dashboard.noUsers')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {t('dashboard.table.name')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {t('common.email')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {t('common.role')}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                      {t('dashboard.table.registeredAt')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentUsers.map((user) => (
                    <tr key={user.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-6 py-4 font-medium text-slate-900">
                        {user.name ?? <span className="italic text-slate-400">—</span>}
                      </td>
                      <td className="px-6 py-4 text-slate-600">{user.email}</td>
                      <td className="px-6 py-4">
                        {user.isGlobalAdmin ? (
                          <Badge variant="default" className="bg-blue-600 text-xs text-white">
                            {t('common.roleAdmin')}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            {t('common.roleUser')}
                          </Badge>
                        )}
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {format.dateTime(user.createdAt, SHORT_DATE)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Additional summary */}
      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardContent className="p-6">
          <div className="flex flex-wrap gap-6">
            <div className="text-center">
              <p className="text-2xl font-bold text-slate-900">
                {format.number(totalApplications)}
              </p>
              <p className="mt-1 text-xs text-slate-500">{t('dashboard.totalApplications')}</p>
            </div>
            <div className="w-px self-stretch bg-slate-200" />
            <div className="text-center">
              <p className="text-2xl font-bold text-slate-900">
                {totalUsers > 0 ? ((activeSubscriptions / totalOrgs) * 100).toFixed(0) : 0}%
              </p>
              <p className="mt-1 text-xs text-slate-500">{t('dashboard.orgsWithSubscription')}</p>
            </div>
            <div className="w-px self-stretch bg-slate-200" />
            <div className="text-center">
              <p className="text-2xl font-bold text-slate-900">
                {totalJobs > 0 && totalApplications > 0
                  ? (totalApplications / totalJobs).toFixed(1)
                  : '0'}
              </p>
              <p className="mt-1 text-xs text-slate-500">{t('dashboard.applicationsPerJob')}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
