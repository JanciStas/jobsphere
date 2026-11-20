import Link from 'next/link'
import type { Metadata } from 'next'
import { getFormatter, getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { Card, CardContent } from '@/components/ui/card'
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
  return { title: t('proposalsPage.title') }
}

export default async function AgencyProposalsPage({ params }: { params: { locale: string } }) {
  const { orgId } = await requireAgency(params.locale)
  const t = await getTranslations({ locale: params.locale, namespace: 'agencyDashboard' })
  const format = await getFormatter({ locale: params.locale })

  const proposals = await prisma.gigProposal.findMany({
    where: { gig: { orgId } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 200,
    select: {
      id: true,
      status: true,
      proposedRate: true,
      proposedDurationDays: true,
      message: true,
      createdAt: true,
      gig: { select: { id: true, title: true, currency: true } },
      freelancer: { select: { id: true, title: true, user: { select: { name: true } } } },
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('proposalsPage.title')}</h1>
        <p className="text-muted-foreground">{t('proposalsPage.subtitle')}</p>
      </div>
      {proposals.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {t('proposalsPage.empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => (
            <Card key={p.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <Link
                      href={`/${params.locale}/freelancers/${p.freelancer.id}`}
                      className="font-semibold hover:underline"
                    >
                      {p.freelancer.user.name || t('common.freelancer')}
                    </Link>
                    {p.freelancer.title && (
                      <span className="text-sm text-muted-foreground"> · {p.freelancer.title}</span>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {t('proposalsPage.forGig')}{' '}
                      <Link
                        href={`/${params.locale}/agency/gigs/${p.gig.id}`}
                        className="text-primary hover:underline"
                      >
                        {p.gig.title}
                      </Link>
                    </p>
                  </div>
                  <StatusBadge status={p.status} label={t(`proposalStatus.${p.status}`)} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {p.proposedRate != null && `${p.proposedRate} ${p.gig.currency} · `}
                  {p.proposedDurationDays != null &&
                    `${t('common.days', { count: p.proposedDurationDays })} · `}
                  {format.dateTime(p.createdAt, SHORT_DATE)}
                </p>
                {p.message && <p className="whitespace-pre-wrap text-sm">{p.message}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
