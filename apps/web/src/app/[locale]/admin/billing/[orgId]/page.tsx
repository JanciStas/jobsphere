import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { SHORT_DATE } from '@/lib/formats'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getCurrentPlan, STARTER_LIMITS } from '@/lib/entitlements'
import { FEATURES, isManualSubscription, stripeDashboardUrl } from '@/lib/admin-billing'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { BillingActions } from '../_components/billing-actions'

const USAGE_KEYS = ['MAX_JOBS', 'MAX_CANDIDATES', 'MAX_TEAM_MEMBERS'] as const

export default async function AdminBillingDetailPage({
  params,
}: {
  params: { locale: string; orgId: string }
}) {
  const session = await auth()
  if (!session?.user?.isGlobalAdmin) {
    redirect(`/${params.locale}/login?error=forbidden`)
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(params.orgId)) notFound()

  const format = await getFormatter()
  const t = await getTranslations('adminBilling')

  const org = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true, name: true, slug: true, deletedAt: true },
  })
  if (!org) notFound()

  const [plan, entitlements, jobs, members, candidates, history] = await Promise.all([
    getCurrentPlan(org.id),
    prisma.entitlement.findMany({
      where: { orgId: org.id },
      select: { featureKey: true, limitInt: true },
    }),
    prisma.job.count({ where: { orgId: org.id, status: 'PUBLISHED' } }),
    prisma.userOrgRole.count({ where: { orgId: org.id, deletedAt: null } }),
    prisma.application.count({ where: { orgId: org.id } }),
    prisma.subscription.findMany({
      where: { orgId: org.id },
      include: { product: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ])

  const overrides = new Map(entitlements.map((e) => [e.featureKey, e.limitInt]))
  const limitOf = (key: (typeof FEATURES)[number]): number | null =>
    overrides.has(key) ? (overrides.get(key) ?? null) : (STARTER_LIMITS[key] ?? null)
  const used: Record<string, number> = {
    MAX_JOBS: jobs,
    MAX_CANDIDATES: candidates,
    MAX_TEAM_MEMBERS: members,
  }
  const fmtLimit = (l: number | null) => (l === null ? t('unlimited') : String(l))

  const live = history.find((s) => s.status === 'active' || s.status === 'trialing')
  const stripeManaged = Boolean(live && !isManualSubscription(live.providerSubId))
  const stripeUrl = live ? stripeDashboardUrl(live.providerSubId) : null

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div>
        <Link
          href={`/${params.locale}/admin/subscriptions`}
          className="text-sm text-slate-500 underline"
        >
          {t('back')}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">
          {org.name}
          {org.deletedAt && (
            <Badge variant="destructive" className="ml-3">
              {t('orgDeleted')}
            </Badge>
          )}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {t('detail.currentPlan')}: <strong>{plan ?? '—'}</strong>
          {live && isManualSubscription(live.providerSubId) && (
            <Badge variant="outline" className="ml-2">
              {t('manual')}
            </Badge>
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('detail.actions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <BillingActions
            orgId={org.id}
            orgDeleted={org.deletedAt !== null}
            hasLiveSubscription={Boolean(live)}
            stripeManaged={stripeManaged}
            stripeUrl={stripeUrl}
            features={FEATURES.map((key) => ({ key, limit: limitOf(key) }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('detail.limitsVsUsage')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('detail.feature')}</TableHead>
                <TableHead>{t('detail.limit')}</TableHead>
                <TableHead>{t('detail.usage')}</TableHead>
                <TableHead>{t('detail.source')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FEATURES.map((key) => {
                const limit = limitOf(key)
                const u = (USAGE_KEYS as readonly string[]).includes(key) ? used[key] : null
                const over = u !== null && limit !== null && u > limit
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">{t(`features.${key}`)}</TableCell>
                    <TableCell>{fmtLimit(limit)}</TableCell>
                    <TableCell className={over ? 'font-semibold text-red-600' : undefined}>
                      {u === null ? '—' : u}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {overrides.has(key)
                        ? t('detail.sourceEntitlement')
                        : t('detail.sourceDefault')}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('detail.history')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table.plan')}</TableHead>
                <TableHead>{t('table.status')}</TableHead>
                <TableHead>{t('table.period')}</TableHead>
                <TableHead>{t('table.cancelAt')}</TableHead>
                <TableHead>{t('detail.stripe')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((s) => {
                const url = stripeDashboardUrl(s.providerSubId)
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      {s.product.name}
                      {isManualSubscription(s.providerSubId) && (
                        <Badge variant="outline" className="ml-2">
                          {t('manual')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{s.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {format.dateTime(s.currentPeriodStart, SHORT_DATE)} –{' '}
                      {format.dateTime(s.currentPeriodEnd, SHORT_DATE)}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {s.cancelAt ? format.dateTime(s.cancelAt, SHORT_DATE) : '—'}
                    </TableCell>
                    <TableCell>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm underline"
                        >
                          {t('detail.openStripe')}
                        </a>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {history.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-slate-500">
                    {t('detail.noHistory')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
