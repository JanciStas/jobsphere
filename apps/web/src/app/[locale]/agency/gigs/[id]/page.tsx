import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { ArrowLeft } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SHORT_DATE } from '@/lib/formats'
import { requireAgency } from '../../_lib/agency-context'
import { StatusBadge } from '../../_lib/status-badge'
import { ProposalActions } from './proposal-actions'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'agencyDashboard' })
  return { title: t('gigDetail.title') }
}

export default async function AgencyGigDetailPage({
  params,
}: {
  params: { locale: string; id: string }
}) {
  const { orgId } = await requireAgency(params.locale)
  const t = await getTranslations({ locale: params.locale, namespace: 'agencyDashboard' })
  const format = await getFormatter({ locale: params.locale })

  // Scoped by orgId: a foreign gig is a 404, never a leak.
  const gig = await prisma.gig.findFirst({
    where: { id: params.id, orgId },
    select: {
      id: true,
      title: true,
      description: true,
      budget: true,
      currency: true,
      durationDays: true,
      status: true,
      proposals: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: {
          id: true,
          status: true,
          proposedRate: true,
          proposedDurationDays: true,
          message: true,
          createdAt: true,
          freelancer: { select: { id: true, title: true, user: { select: { name: true } } } },
        },
      },
    },
  })
  if (!gig) notFound()

  return (
    <div className="space-y-6">
      <Link
        href={`/${params.locale}/agency/gigs`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('gigDetail.back')}
      </Link>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <CardTitle className="text-xl">{gig.title}</CardTitle>
            <StatusBadge status={gig.status} label={t(`status.${gig.status}`)} />
          </div>
          <p className="text-sm text-muted-foreground">
            {gig.budget != null && `${gig.budget} ${gig.currency}`}
            {gig.budget != null && gig.durationDays != null && ' · '}
            {gig.durationDays != null && t('common.days', { count: gig.durationDays })}
          </p>
        </CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm">{gig.description}</p>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-lg font-semibold">
          {t('gigDetail.proposals')} ({gig.proposals.length})
        </h2>
        {gig.proposals.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {t('gigDetail.noProposals')}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {gig.proposals.map((p) => (
              <Card key={p.id}>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <Link
                        href={`/${params.locale}/freelancers/${p.freelancer.id}`}
                        className="font-semibold hover:underline"
                      >
                        {p.freelancer.user.name || t('common.freelancer')}
                      </Link>
                      {p.freelancer.title && (
                        <span className="text-sm text-muted-foreground">
                          {' '}
                          · {p.freelancer.title}
                        </span>
                      )}
                      <p className="text-sm text-muted-foreground">
                        {p.proposedRate != null && `${p.proposedRate} ${gig.currency} · `}
                        {p.proposedDurationDays != null &&
                          `${t('common.days', { count: p.proposedDurationDays })} · `}
                        {format.dateTime(p.createdAt, SHORT_DATE)}
                      </p>
                    </div>
                    <StatusBadge status={p.status} label={t(`proposalStatus.${p.status}`)} />
                  </div>
                  {p.message && <p className="whitespace-pre-wrap text-sm">{p.message}</p>}
                  {p.status === 'PENDING' && gig.status === 'OPEN' && (
                    <ProposalActions gigId={gig.id} proposalId={p.id} />
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
