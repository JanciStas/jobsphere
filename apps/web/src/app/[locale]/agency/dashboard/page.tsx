import Link from 'next/link'
import type { Metadata } from 'next'
import { getFormatter, getTranslations } from 'next-intl/server'
import { Briefcase, Inbox, Clock, CheckCircle2, PlusCircle } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatCard } from '@/components/dashboard/stat-card'
import { SHORT_DATE } from '@/lib/formats'
import { requireAgency } from '../_lib/agency-context'
import { StatusBadge } from '../_lib/status-badge'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'agencyDashboard' })
  return { title: t('dashboard.title') }
}

export default async function AgencyDashboardPage({ params }: { params: { locale: string } }) {
  const { orgId } = await requireAgency(params.locale)
  const t = await getTranslations({ locale: params.locale, namespace: 'agencyDashboard' })
  const format = await getFormatter({ locale: params.locale })

  // Sequential on purpose (pgBouncer transaction mode + parallel prepared statements).
  const activeGigs = await prisma.gig.count({ where: { orgId, status: 'OPEN' } })
  const filledGigs = await prisma.gig.count({ where: { orgId, status: 'IN_PROGRESS' } })
  const receivedProposals = await prisma.gigProposal.count({ where: { gig: { orgId } } })
  const pendingProposals = await prisma.gigProposal.count({
    where: { gig: { orgId }, status: 'PENDING' },
  })
  const recent = await prisma.gigProposal.findMany({
    where: { gig: { orgId } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 6,
    select: {
      id: true,
      status: true,
      proposedRate: true,
      createdAt: true,
      gig: { select: { id: true, title: true, currency: true } },
      freelancer: { select: { id: true, user: { select: { name: true } } } },
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
          <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>
        </div>
        <Button asChild>
          <Link href={`/${params.locale}/agency/gigs/new`}>
            <PlusCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('dashboard.newGig')}
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard value={activeGigs} label={t('dashboard.kpi.activeGigs')} icon={Briefcase} />
        <StatCard
          value={receivedProposals}
          label={t('dashboard.kpi.receivedProposals')}
          icon={Inbox}
        />
        <StatCard
          value={pendingProposals}
          label={t('dashboard.kpi.pendingProposals')}
          icon={Clock}
        />
        <StatCard value={filledGigs} label={t('dashboard.kpi.filledGigs')} icon={CheckCircle2} />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">{t('dashboard.recentProposals')}</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/${params.locale}/agency/proposals`}>{t('dashboard.viewAll')}</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t('dashboard.noProposals')}
            </p>
          ) : (
            <ul className="divide-y">
              {recent.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/${params.locale}/agency/gigs/${p.gig.id}`}
                      className="font-medium hover:underline"
                    >
                      {p.gig.title}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {p.freelancer.user.name || t('common.freelancer')}
                      {p.proposedRate != null && ` · ${p.proposedRate} ${p.gig.currency}`}
                      {' · '}
                      {format.dateTime(p.createdAt, SHORT_DATE)}
                    </p>
                  </div>
                  <StatusBadge status={p.status} label={t(`proposalStatus.${p.status}`)} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
