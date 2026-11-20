import Link from 'next/link'
import { redirect } from 'next/navigation'
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
import { JobStatusSelect } from './_components/job-status-select'
import { JobStatusFilter } from './_components/job-status-filter'
import { CreateJobButton } from './_components/create-job-button'
import { EditJobDialog } from './_components/edit-job-dialog'
import type { Metadata } from 'next'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'admin' })
  return { title: t('jobs.metaTitle') }
}

const STATUS_COLORS: Record<string, string> = {
  PUBLISHED: 'bg-green-100 text-green-800 hover:bg-green-100',
  DRAFT: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
  CLOSED: 'bg-red-100 text-red-800 hover:bg-red-100',
  PAUSED: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100',
}

export default async function AdminJobsPage({
  params,
  searchParams,
}: {
  params: { locale: string }
  searchParams: { status?: string; search?: string; page?: string; deleted?: string }
}) {
  const session = await auth()
  const format = await getFormatter()
  const t = await getTranslations('admin')
  const tm = await getTranslations('adminMarketplace')
  if (!session?.user?.isGlobalAdmin) {
    redirect(`/${params.locale}/login?error=forbidden`)
  }

  const status = searchParams.status ?? undefined
  const search = searchParams.search ?? undefined
  const page = Math.max(1, Number(searchParams.page ?? '1'))
  const limit = 50
  const skip = (page - 1) * limit

  // Soft-deleted jobs are hidden by the prisma middleware; `deleted=1` opts in to
  // looking at exactly those (explicit deletedAt filter), so they can be restored.
  const showDeleted = searchParams.deleted === '1'
  const where = {
    ...(showDeleted ? { deletedAt: { not: null } } : {}),
    ...(status ? { status } : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' as const } },
            { organization: { name: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }

  const [jobs, total, orgs] = await Promise.all([
    prisma.job.findMany({
      where,
      select: {
        id: true,
        title: true,
        status: true,
        orgId: true,
        description: true,
        city: true,
        salaryMin: true,
        salaryMax: true,
        salaryCurrency: true,
        deletedAt: true,
        createdAt: true,
        organization: { select: { name: true } },
        _count: { select: { applications: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.job.count({ where }),
    // Active organizations for the "create job" org picker.
    prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
  ])

  const totalPages = Math.ceil(total / limit)

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('jobs.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('jobs.totalCount', { count: total })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={
              showDeleted
                ? `/${params.locale}/admin/jobs`
                : `/${params.locale}/admin/jobs?deleted=1`
            }
            className="rounded-md border px-3 py-2 text-sm hover:bg-slate-100"
          >
            {showDeleted ? tm('jobs.hideDeleted') : tm('jobs.showDeleted')}
          </Link>
          <JobStatusFilter currentStatus={status} />
          <CreateJobButton orgs={orgs} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('jobs.allJobs')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('jobs.table.title')}</TableHead>
                <TableHead>{t('common.organization')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('common.applications')}</TableHead>
                <TableHead>{t('common.date')}</TableHead>
                <TableHead className="text-right">{t('jobs.table.changeStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="max-w-xs truncate font-medium">{job.title}</TableCell>
                  <TableCell className="text-sm">
                    <Link
                      href={`/${params.locale}/admin/organizations/${job.orgId}`}
                      className="text-blue-600 hover:underline"
                    >
                      {job.organization.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_COLORS[job.status] ?? 'bg-slate-100 text-slate-700'}>
                      {job.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm">{job._count.applications}</TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {format.dateTime(job.createdAt, SHORT_DATE)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {!job.deletedAt && (
                        <JobStatusSelect jobId={job.id} currentStatus={job.status} />
                      )}
                      <EditJobDialog
                        job={{
                          id: job.id,
                          title: job.title,
                          description: job.description,
                          city: job.city,
                          salaryMin: job.salaryMin,
                          salaryMax: job.salaryMax,
                          salaryCurrency: job.salaryCurrency,
                          status: job.status,
                          deleted: job.deletedAt !== null,
                        }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                    {t('jobs.empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <p className="text-center text-sm text-slate-500">
          {t('common.pageOf', { page, totalPages })}
        </p>
      )}
    </div>
  )
}
