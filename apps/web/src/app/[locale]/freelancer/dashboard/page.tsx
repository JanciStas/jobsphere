import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Eye, Hourglass, CheckCircle2, GalleryHorizontal, Send } from 'lucide-react'
import { requireFreelancerUserId } from '../_lib/require-freelancer-user'
import { prisma } from '@/lib/prisma'
import { countPortfolioItems } from '@/lib/portfolio-safe'
import { StatCard } from '@/components/dashboard/stat-card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export const dynamic = 'force-dynamic'

export default async function FreelancerDashboardPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'freelancerDashboard' })
  const userId = await requireFreelancerUserId(locale)

  const profile = await prisma.freelancerProfile.findUnique({
    where: { userId },
    select: { id: true },
  })

  const [grouped, recent, portfolioCount, gigs] = await Promise.all([
    profile
      ? prisma.gigProposal.groupBy({
          by: ['status'],
          where: { freelancerId: profile.id },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    profile
      ? prisma.gigProposal.findMany({
          where: { freelancerId: profile.id },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            status: true,
            createdAt: true,
            gig: { select: { id: true, title: true } },
          },
        })
      : Promise.resolve([]),
    profile ? countPortfolioItems(profile.id) : Promise.resolve(0),
    prisma.gig.findMany({
      where: { status: 'OPEN', organization: { deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, budget: true, currency: true },
    }),
  ])

  const count = (status: string) => grouped.find((g) => g.status === status)?._count._all ?? 0
  const total = grouped.reduce((sum, g) => sum + g._count._all, 0)
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('overview.title')}</h1>
          <p className="text-muted-foreground">{t('overview.subtitle')}</p>
        </div>
        {profile && (
          <Button variant="outline" asChild>
            <Link href={`/${locale}/freelancers/${profile.id}`}>
              <Eye className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('overview.viewPublic')}
            </Link>
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <StatCard value={total} label={t('overview.kpiProposals')} icon={Send} />
        <StatCard value={count('PENDING')} label={t('overview.kpiPending')} icon={Hourglass} />
        <StatCard value={count('ACCEPTED')} label={t('overview.kpiAccepted')} icon={CheckCircle2} />
        <StatCard
          value={portfolioCount}
          label={t('overview.kpiPortfolio')}
          icon={GalleryHorizontal}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{t('overview.recentProposals')}</h2>
            <Link
              href={`/${locale}/freelancer/proposals`}
              className="text-sm text-primary hover:underline"
            >
              {t('overview.viewAll')}
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('overview.noProposals')}</p>
          ) : (
            <ul className="divide-y">
              {recent.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.gig.title}</p>
                    <p className="text-xs text-muted-foreground">{fmt.format(p.createdAt)}</p>
                  </div>
                  <Badge variant={p.status === 'ACCEPTED' ? 'default' : 'secondary'}>
                    {t(`proposals.status.${p.status}` as 'proposals.status.PENDING')}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">{t('overview.openGigs')}</h2>
            <Link href={`/${locale}/gigs`} className="text-sm text-primary hover:underline">
              {t('overview.viewAll')}
            </Link>
          </div>
          {gigs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('overview.noGigs')}</p>
          ) : (
            <ul className="divide-y">
              {gigs.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    href={`/${locale}/gigs`}
                    className="min-w-0 truncate text-sm font-medium hover:text-primary"
                  >
                    {g.title}
                  </Link>
                  {g.budget != null && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {g.budget} {g.currency}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
