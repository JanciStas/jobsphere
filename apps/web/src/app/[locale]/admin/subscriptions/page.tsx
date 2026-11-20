import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { CheckCircle2, Clock, AlertTriangle, XCircle, Euro } from 'lucide-react'
import { SHORT_DATE } from '@/lib/formats'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { estimateMrrCents, isManualSubscription } from '@/lib/admin-billing'
import { StatCard } from '@/components/dashboard/stat-card'
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
import type { Metadata } from 'next'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'adminBilling' })
  return { title: t('metaTitle') }
}

const STATUSES = ['active', 'trialing', 'past_due', 'canceled', 'unpaid'] as const
const PAGE_SIZE = 20

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800 hover:bg-green-100',
  trialing: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
  past_due: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100',
  canceled: 'bg-red-100 text-red-800 hover:bg-red-100',
  unpaid: 'bg-orange-100 text-orange-800 hover:bg-orange-100',
}

interface PageProps {
  params: { locale: string }
  searchParams: { status?: string; q?: string; orgId?: string; page?: string }
}

export default async function AdminSubscriptionsPage({ params, searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user?.isGlobalAdmin) {
    redirect(`/${params.locale}/login?error=forbidden`)
  }
  const format = await getFormatter()
  const t = await getTranslations('adminBilling')

  const status = STATUSES.find((s) => s === searchParams.status)
  const q = searchParams.q?.trim().slice(0, 100) ?? ''
  const orgId = /^[A-Za-z0-9_-]{1,64}$/.test(searchParams.orgId ?? '')
    ? searchParams.orgId
    : undefined
  const page = Math.max(1, Math.floor(Number(searchParams.page ?? 1)) || 1)

  const where = {
    ...(status ? { status } : {}),
    ...(orgId ? { orgId } : {}),
    ...(q ? { organization: { name: { contains: q, mode: 'insensitive' as const } } } : {}),
  }
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)

  const [rows, total, active, trialing, pastDue, canceled30, mrrSubs] = await Promise.all([
    prisma.subscription.findMany({
      where,
      include: {
        organization: { select: { id: true, name: true, slug: true, deletedAt: true } },
        product: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.subscription.count({ where }),
    prisma.subscription.count({ where: { status: 'active' } }),
    prisma.subscription.count({ where: { status: 'trialing' } }),
    prisma.subscription.count({ where: { status: 'past_due' } }),
    prisma.subscription.count({
      where: {
        status: 'canceled',
        OR: [{ canceledAt: { gte: since } }, { endedAt: { gte: since } }],
      },
    }),
    prisma.subscription.findMany({
      where: { status: 'active' },
      select: {
        providerSubId: true,
        product: {
          select: {
            prices: {
              where: { isActive: true },
              select: { currency: true, amount: true, interval: true, intervalCount: true },
            },
          },
        },
      },
      take: 5000,
    }),
  ])

  const mrr = estimateMrrCents(mrrSubs) / 100
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const link = (p: number) => {
    const sp = new URLSearchParams()
    if (status) sp.set('status', status)
    if (q) sp.set('q', q)
    if (orgId) sp.set('orgId', orgId)
    if (p > 1) sp.set('page', String(p))
    const qs = sp.toString()
    return `/${params.locale}/admin/subscriptions${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('subtitle', { count: total })}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard value={active} label={t('kpi.active')} icon={CheckCircle2} />
        <StatCard value={trialing} label={t('kpi.trialing')} icon={Clock} />
        <StatCard value={pastDue} label={t('kpi.pastDue')} icon={AlertTriangle} />
        <StatCard value={canceled30} label={t('kpi.canceled30')} icon={XCircle} />
        <StatCard
          value={format.number(mrr, {
            style: 'currency',
            currency: 'EUR',
            maximumFractionDigits: 0,
          })}
          label={t('kpi.mrr')}
          icon={Euro}
        />
      </div>
      <p className="text-xs text-slate-500">{t('kpi.mrrNote')}</p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('allSubscriptions')}</CardTitle>
          <form method="get" className="mt-3 flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">{t('filters.search')}</span>
              <input
                name="q"
                defaultValue={q}
                className="h-9 rounded-md border bg-background px-3 text-sm"
                maxLength={100}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-slate-500">{t('filters.status')}</span>
              <select
                name="status"
                defaultValue={status ?? ''}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">{t('filters.allStatuses')}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            {orgId && <input type="hidden" name="orgId" value={orgId} />}
            <button
              type="submit"
              className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              {t('filters.apply')}
            </button>
            {(status || q || orgId) && (
              <Link href={`/${params.locale}/admin/subscriptions`} className="text-sm underline">
                {t('filters.reset')}
              </Link>
            )}
          </form>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('table.organization')}</TableHead>
                <TableHead>{t('table.plan')}</TableHead>
                <TableHead>{t('table.status')}</TableHead>
                <TableHead>{t('table.period')}</TableHead>
                <TableHead>{t('table.cancelAt')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell>
                    <p className="font-medium">{sub.organization.name}</p>
                    <p className="text-xs text-slate-400">
                      {sub.organization.slug}
                      {sub.organization.deletedAt ? ` · ${t('orgDeleted')}` : ''}
                    </p>
                  </TableCell>
                  <TableCell className="text-sm">
                    {sub.product.name}
                    {isManualSubscription(sub.providerSubId) && (
                      <Badge variant="outline" className="ml-2">
                        {t('manual')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_COLORS[sub.status] ?? 'bg-slate-100 text-slate-700'}>
                      {STATUSES.includes(sub.status as (typeof STATUSES)[number])
                        ? t(`status.${sub.status}`)
                        : sub.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {format.dateTime(sub.currentPeriodStart, SHORT_DATE)} –{' '}
                    {format.dateTime(sub.currentPeriodEnd, SHORT_DATE)}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {sub.cancelAt ? format.dateTime(sub.cancelAt, SHORT_DATE) : '—'}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/${params.locale}/admin/billing/${sub.organization.id}`}
                      className="text-sm font-medium text-primary underline"
                    >
                      {t('table.detail')}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {pages > 1 && (
        <nav
          className="flex items-center justify-between text-sm"
          aria-label={t('pagination.label')}
        >
          {page > 1 ? (
            <Link href={link(page - 1)} className="underline">
              {t('pagination.prev')}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-slate-500">{t('pagination.of', { page, pages })}</span>
          {page < pages ? (
            <Link href={link(page + 1)} className="underline">
              {t('pagination.next')}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  )
}
