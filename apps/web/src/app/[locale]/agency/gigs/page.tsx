import Link from 'next/link'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { PlusCircle } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { Button } from '@/components/ui/button'
import { requireAgency } from '../_lib/agency-context'
import { AgencyGigsList, type AgencyGigRow } from './agency-gigs-list'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'agencyDashboard' })
  return { title: t('gigs.title') }
}

export default async function AgencyGigsPage({ params }: { params: { locale: string } }) {
  const { orgId } = await requireAgency(params.locale)
  const t = await getTranslations({ locale: params.locale, namespace: 'agencyDashboard' })

  const gigs = await prisma.gig.findMany({
    where: { orgId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      title: true,
      budget: true,
      currency: true,
      durationDays: true,
      status: true,
      _count: { select: { proposals: true } },
    },
  })
  const rows: AgencyGigRow[] = gigs.map((g) => ({
    id: g.id,
    title: g.title,
    budget: g.budget,
    currency: g.currency,
    durationDays: g.durationDays,
    status: g.status,
    proposalCount: g._count.proposals,
  }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('gigs.title')}</h1>
          <p className="text-muted-foreground">{t('gigs.subtitle')}</p>
        </div>
        <Button asChild>
          <Link href={`/${params.locale}/agency/gigs/new`}>
            <PlusCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('dashboard.newGig')}
          </Link>
        </Button>
      </div>
      <AgencyGigsList locale={params.locale} gigs={rows} />
    </div>
  )
}
