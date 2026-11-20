import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { SHORT_DATE } from '@/lib/formats'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
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
import { ConfirmDeleteButton } from '@/components/admin/confirm-delete-button'
import { GigEditForm } from '../_components/gig-edit-form'
import { ProposalStatusSelect } from '../_components/proposal-status-select'

export default async function AdminGigDetailPage({
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

  const gig = await prisma.gig.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      description: true,
      budget: true,
      currency: true,
      durationDays: true,
      status: true,
      createdAt: true,
      organization: { select: { id: true, name: true } },
      creator: { select: { id: true, name: true, email: true } },
      proposals: {
        select: {
          id: true,
          status: true,
          proposedRate: true,
          proposedDurationDays: true,
          message: true,
          createdAt: true,
          freelancer: {
            select: { id: true, user: { select: { name: true, email: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      },
    },
  })
  if (!gig) notFound()

  const hasAccepted = gig.proposals.some((p) => p.status === 'ACCEPTED')

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href={`/${params.locale}/admin/gigs`}
            className="text-sm text-slate-500 hover:underline"
          >
            ← {t('common.back')}
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">{gig.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            <Link
              href={`/${params.locale}/admin/organizations/${gig.organization.id}`}
              className="text-blue-600 hover:underline"
            >
              {gig.organization.name}
            </Link>
            {' · '}
            {t('gigs.detail.createdBy', { name: gig.creator.name ?? gig.creator.email })}
            {' · '}
            {format.dateTime(gig.createdAt, SHORT_DATE)}
          </p>
        </div>
        <ConfirmDeleteButton
          endpoint={`/api/admin/gigs/${gig.id}`}
          redirectTo={`/${params.locale}/admin/gigs`}
          triggerLabel={t('gigs.detail.delete')}
          title={t('gigs.detail.deleteTitle')}
          description={t('gigs.detail.deleteBody', {
            title: gig.title,
            count: gig.proposals.length,
          })}
          confirmLabel={t('gigs.detail.deleteConfirm')}
          cancelLabel={t('common.cancel')}
          failedLabel={t('common.deleteFailed')}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('gigs.detail.edit')}</CardTitle>
        </CardHeader>
        <CardContent>
          <GigEditForm
            gigId={gig.id}
            initial={{
              title: gig.title,
              description: gig.description,
              budget: gig.budget,
              currency: gig.currency,
              durationDays: gig.durationDays,
              status: gig.status,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('gigs.detail.proposals')}</CardTitle>
          <p className="text-xs text-slate-500">{t('gigs.detail.oneAcceptedRule')}</p>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('gigs.detail.freelancer')}</TableHead>
                <TableHead>{t('gigs.detail.rate')}</TableHead>
                <TableHead>{t('gigs.detail.message')}</TableHead>
                <TableHead>{t('common.created')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('gigs.detail.changeStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gig.proposals.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/${params.locale}/admin/freelancers/${p.freelancer.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {p.freelancer.user.name ?? p.freelancer.user.email}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    {p.proposedRate ?? '—'}
                    {p.proposedDurationDays != null &&
                      ` · ${t('gigs.detail.days', { count: p.proposedDurationDays })}`}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-slate-500">
                    {p.message ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {format.dateTime(p.createdAt, SHORT_DATE)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`proposalStatusLabels.${p.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <ProposalStatusSelect
                      gigId={gig.id}
                      proposalId={p.id}
                      currentStatus={p.status}
                      otherAccepted={hasAccepted && p.status !== 'ACCEPTED'}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {gig.proposals.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-slate-500">
                    {t('gigs.detail.noProposals')}
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
