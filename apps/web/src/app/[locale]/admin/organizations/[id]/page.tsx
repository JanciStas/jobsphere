import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { SHORT_DATE, SHORT_DATE_TIME } from '@/lib/formats'
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
import { OrgActionButton } from '../_components/org-action-button'
import { EditOrgDialog } from '../_components/edit-org-dialog'

export default async function AdminOrganizationDetailPage({
  params,
}: {
  params: { locale: string; id: string }
}) {
  const session = await auth()
  const format = await getFormatter()
  const t = await getTranslations('admin')
  const tm = await getTranslations('adminMarketplace')
  if (!session?.user?.isGlobalAdmin) {
    redirect(`/${params.locale}/login?error=forbidden`)
  }

  const org = await prisma.organization.findUnique({
    where: { id: params.id },
    include: {
      users: {
        include: { user: { select: { id: true, name: true, email: true } } },
        where: { deletedAt: null },
        take: 50,
      },
      jobs: {
        where: { status: 'PUBLISHED', deletedAt: null },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          _count: { select: { applications: true } },
        },
        take: 20,
        orderBy: { createdAt: 'desc' },
      },
      gigs: {
        select: {
          id: true,
          title: true,
          status: true,
          budget: true,
          currency: true,
          createdAt: true,
          _count: { select: { proposals: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      subscriptions: {
        include: { product: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
  })

  if (!org) notFound()

  const suspended = org.deletedAt !== null
  const isAgency = org.users.some((m) => m.role === 'AGENCY')

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            {org.name}
            <Badge variant="outline">
              {isAgency ? tm('organizations.agency') : tm('organizations.company')}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            slug: <span className="font-mono">{org.slug}</span>
            {org.industry && ` · ${org.industry}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {suspended ? (
            <Badge variant="destructive">{t('organizations.suspended')}</Badge>
          ) : (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              {t('organizations.active')}
            </Badge>
          )}
          <Link
            href={`/${params.locale}/admin/subscriptions?orgId=${org.id}`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-slate-100"
          >
            {tm('organizations.payments')}
          </Link>
          <EditOrgDialog
            orgId={org.id}
            slug={org.slug}
            name={org.name}
            industry={org.industry}
            size={org.size}
            website={org.website}
          />
          <OrgActionButton orgId={org.id} suspended={suspended} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{org.users.length}</p>
            <p className="text-sm text-slate-500">{t('organizations.detail.members')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{org.jobs.length}</p>
            <p className="text-sm text-slate-500">{t('organizations.detail.activeJobs')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-2xl font-bold">{org.subscriptions.length}</p>
            <p className="text-sm text-slate-500">{t('organizations.detail.subscriptions')}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('organizations.detail.members')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('organizations.detail.memberName')}</TableHead>
                <TableHead>{t('common.email')}</TableHead>
                <TableHead>{t('common.role')}</TableHead>
                <TableHead>{t('organizations.detail.memberSince')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.users.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">{m.user.name ?? '—'}</TableCell>
                  <TableCell className="text-slate-500">{m.user.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{m.role}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {format.dateTime(m.createdAt, SHORT_DATE)}
                  </TableCell>
                </TableRow>
              ))}
              {org.users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-slate-500">
                    {t('organizations.detail.noMembers')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('organizations.detail.activeJobs')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('organizations.detail.position')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('common.applications')}</TableHead>
                <TableHead>{t('common.date')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/${params.locale}/admin/jobs?search=${encodeURIComponent(job.title)}`}
                      className="text-blue-600 hover:underline"
                    >
                      {job.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{job.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right">{job._count.applications}</TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {format.dateTime(job.createdAt, SHORT_DATE)}
                  </TableCell>
                </TableRow>
              ))}
              {org.jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-slate-500">
                    {t('organizations.detail.noJobs')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{tm('organizations.gigs')}</CardTitle>
          <div className="flex gap-3 text-sm">
            <Link
              href={`/${params.locale}/admin/jobs?search=${encodeURIComponent(org.name)}`}
              className="text-blue-600 hover:underline"
            >
              {tm('organizations.allJobs')}
            </Link>
            <Link
              href={`/${params.locale}/admin/gigs?orgId=${org.id}`}
              className="text-blue-600 hover:underline"
            >
              {tm('organizations.allGigs')}
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tm('gigs.table.title')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead>{tm('gigs.table.budget')}</TableHead>
                <TableHead className="text-right">{tm('gigs.table.proposals')}</TableHead>
                <TableHead>{t('common.date')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.gigs.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <Link
                      href={`/${params.locale}/admin/gigs/${g.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {g.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{tm(`gigStatusLabels.${g.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {g.budget != null ? `${g.budget} ${g.currency}` : '—'}
                  </TableCell>
                  <TableCell className="text-right text-sm">{g._count.proposals}</TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {format.dateTime(g.createdAt, SHORT_DATE)}
                  </TableCell>
                </TableRow>
              ))}
              {org.gigs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-slate-500">
                    {tm('organizations.noGigs')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {org.subscriptions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('organizations.detail.subscriptions')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common.plan')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead>{t('common.period')}</TableHead>
                  <TableHead>{t('common.cancellation')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {org.subscriptions.map((sub) => (
                  <TableRow key={sub.id}>
                    <TableCell className="font-medium">{sub.product.name}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          sub.status === 'active'
                            ? 'bg-green-100 text-green-800 hover:bg-green-100'
                            : sub.status === 'trialing'
                              ? 'bg-blue-100 text-blue-800 hover:bg-blue-100'
                              : sub.status === 'past_due'
                                ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100'
                                : 'bg-red-100 text-red-800 hover:bg-red-100'
                        }
                      >
                        {sub.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {format.dateTime(sub.currentPeriodStart, SHORT_DATE)} –{' '}
                      {format.dateTime(sub.currentPeriodEnd, SHORT_DATE)}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {sub.cancelAt ? format.dateTime(sub.cancelAt, SHORT_DATE) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="text-xs text-slate-400">
        {t('organizations.detail.createdAt', {
          date: format.dateTime(org.createdAt, SHORT_DATE_TIME),
        })}
        {org.website && (
          <>
            {' · '}
            <a href={org.website} target="_blank" rel="noopener noreferrer" className="underline">
              {org.website}
            </a>
          </>
        )}
      </div>
    </div>
  )
}
