import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { WithdrawButton } from './withdraw-button'

export const dynamic = 'force-dynamic'

const STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const
type Status = (typeof STATUSES)[number]

export default async function FreelancerProposalsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'freelancerDashboard.proposals' })
  const session = await auth()

  const proposals = await prisma.gigProposal.findMany({
    where: { freelancer: { userId: session?.user?.id as string } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      status: true,
      proposedRate: true,
      proposedDurationDays: true,
      createdAt: true,
      gig: { select: { title: true, currency: true, organization: { select: { name: true } } } },
    },
  })
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>

      {proposals.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center text-muted-foreground">
          <p>{t('empty')}</p>
          <Button asChild className="mt-4">
            <Link href={`/${locale}/gigs`}>{t('browseGigs')}</Link>
          </Button>
        </div>
      ) : (
        <ul className="space-y-3">
          {proposals.map((p) => {
            const status = (STATUSES as readonly string[]).includes(p.status)
              ? (p.status as Status)
              : 'PENDING'
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.gig.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {p.gig.organization.name} · {fmt.format(p.createdAt)}
                    {p.proposedRate != null && ` · ${p.proposedRate} ${p.gig.currency}`}
                    {p.proposedDurationDays != null && ` · ${p.proposedDurationDays} ${t('days')}`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={status === 'ACCEPTED' ? 'default' : 'secondary'}>
                    {t(`status.${status}`)}
                  </Badge>
                  {status === 'PENDING' && <WithdrawButton proposalId={p.id} />}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
