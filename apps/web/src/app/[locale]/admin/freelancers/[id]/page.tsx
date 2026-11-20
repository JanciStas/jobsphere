import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { SHORT_DATE } from '@/lib/formats'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listPortfolioItems } from '@/lib/portfolio-safe'
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
import { FreelancerEditForm } from '../_components/freelancer-edit-form'
import { PortfolioItemActions } from '../_components/portfolio-item-actions'

export default async function AdminFreelancerDetailPage({
  params,
}: {
  params: { locale: string; id: string }
}) {
  const session = await auth()
  const format = await getFormatter()
  const t = await getTranslations('adminMarketplace')
  if (!session?.user?.isGlobalAdmin) {
    redirect(`/${params.locale}/login?error=forbidden`)
  }

  const profile = await prisma.freelancerProfile.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      bio: true,
      services: true,
      skills: true,
      hourlyRate: true,
      currency: true,
      availability: true,
      location: true,
      portfolioUrl: true,
      visible: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  })
  if (!profile) notFound()

  // The portfolio read degrades to [] if the PortfolioItem table is not in the DB yet.
  const [portfolio, proposals] = await Promise.all([
    listPortfolioItems(profile.id),
    prisma.gigProposal.findMany({
      where: { freelancerId: profile.id },
      select: {
        id: true,
        status: true,
        proposedRate: true,
        createdAt: true,
        gig: { select: { id: true, title: true, organization: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ])

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href={`/${params.locale}/admin/freelancers`}
            className="text-sm text-slate-500 hover:underline"
          >
            ← {t('common.back')}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">
            {profile.user.name ?? profile.user.email}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {profile.user.email} ·{' '}
            <Link
              href={`/${params.locale}/admin/users/${profile.user.id}`}
              className="text-blue-600 hover:underline"
            >
              {t('freelancers.detail.userAccount')}
            </Link>
          </p>
        </div>
        {profile.visible ? (
          <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
            {t('freelancers.visible')}
          </Badge>
        ) : (
          <Badge variant="destructive">{t('freelancers.hidden')}</Badge>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('freelancers.detail.profile')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FreelancerEditForm
            freelancerId={profile.id}
            initial={{
              title: profile.title ?? '',
              bio: profile.bio ?? '',
              services: profile.services,
              skills: profile.skills,
              hourlyRate: profile.hourlyRate,
              availability: profile.availability,
              location: profile.location ?? '',
              portfolioUrl: profile.portfolioUrl ?? '',
              visible: profile.visible,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('freelancers.detail.portfolio')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('freelancers.detail.itemTitle')}</TableHead>
                <TableHead>{t('freelancers.detail.itemUrl')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {portfolio.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <p className="font-medium">{item.title}</p>
                    {item.description && (
                      <p className="max-w-md truncate text-xs text-slate-500">{item.description}</p>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-slate-500">
                    {item.url ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <PortfolioItemActions
                      freelancerId={profile.id}
                      item={{
                        id: item.id,
                        title: item.title,
                        description: item.description ?? '',
                        url: item.url ?? '',
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {portfolio.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-slate-500">
                    {t('freelancers.detail.noPortfolio')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('freelancers.detail.proposals')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('freelancers.detail.gig')}</TableHead>
                <TableHead>{t('common.organization')}</TableHead>
                <TableHead>{t('gigs.detail.rate')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead>{t('common.created')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proposals.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/${params.locale}/admin/gigs/${p.gig.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {p.gig.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {p.gig.organization.name}
                  </TableCell>
                  <TableCell className="text-sm">{p.proposedRate ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`proposalStatusLabels.${p.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {format.dateTime(p.createdAt, SHORT_DATE)}
                  </TableCell>
                </TableRow>
              ))}
              {proposals.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-slate-500">
                    {t('freelancers.detail.noProposals')}
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
