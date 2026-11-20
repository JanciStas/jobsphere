import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { SHORT_DATE } from '@/lib/formats'
import { auth } from '@/lib/auth'
import { listGigs, GIG_STATUSES } from '@/lib/admin-marketplace'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AdminPager } from '@/components/admin/admin-pager'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Metadata } from 'next'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'adminMarketplace' })
  return { title: t('gigs.metaTitle') }
}

const FIELD = 'h-9 rounded-md border border-input bg-background px-3 text-sm'
const LIMIT = 25

const GIG_STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-green-100 text-green-800 hover:bg-green-100',
  IN_PROGRESS: 'bg-blue-100 text-blue-800 hover:bg-blue-100',
  CLOSED: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
}

export default async function AdminGigsPage({
  params,
  searchParams,
}: {
  params: { locale: string }
  searchParams: { search?: string; status?: string; orgId?: string; agency?: string; page?: string }
}) {
  const session = await auth()
  const format = await getFormatter()
  const t = await getTranslations('adminMarketplace')
  if (!session?.user?.isGlobalAdmin) {
    redirect(`/${params.locale}/login?error=forbidden`)
  }

  const page = Math.max(1, Math.floor(Number(searchParams.page ?? '1')) || 1)
  const { items, total } = await listGigs({
    search: searchParams.search,
    status: searchParams.status,
    orgId: searchParams.orgId,
    agency: searchParams.agency,
    page,
    limit: LIMIT,
  })
  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('gigs.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('gigs.totalCount', { count: total })}</p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="search"
          defaultValue={searchParams.search ?? ''}
          placeholder={t('gigs.searchPlaceholder')}
          aria-label={t('common.search')}
          className={`${FIELD} w-64`}
        />
        <select
          name="status"
          defaultValue={searchParams.status ?? ''}
          aria-label={t('common.status')}
          className={FIELD}
        >
          <option value="">{t('gigs.statusAll')}</option>
          {GIG_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`gigStatusLabels.${s}`)}
            </option>
          ))}
        </select>
        <select
          name="agency"
          defaultValue={searchParams.agency ?? ''}
          aria-label={t('gigs.ownerType')}
          className={FIELD}
        >
          <option value="">{t('gigs.ownerAll')}</option>
          <option value="1">{t('gigs.agenciesOnly')}</option>
        </select>
        {searchParams.orgId && <input type="hidden" name="orgId" value={searchParams.orgId} />}
        <Button type="submit" size="sm">
          {t('common.apply')}
        </Button>
        <Button asChild type="button" variant="outline" size="sm">
          <Link href={`/${params.locale}/admin/gigs`}>{t('common.reset')}</Link>
        </Button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('gigs.allGigs')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('gigs.table.title')}</TableHead>
                <TableHead>{t('common.organization')}</TableHead>
                <TableHead>{t('gigs.table.budget')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead className="text-right">{t('gigs.table.proposals')}</TableHead>
                <TableHead>{t('common.created')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="max-w-xs truncate">
                    <Link
                      href={`/${params.locale}/admin/gigs/${g.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {g.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    <Link
                      href={`/${params.locale}/admin/organizations/${g.organization.id}`}
                      className="text-slate-600 hover:underline"
                    >
                      {g.organization.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    {g.budget != null ? `${g.budget} ${g.currency}` : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge className={GIG_STATUS_COLORS[g.status] ?? ''}>
                      {t(`gigStatusLabels.${g.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm">{g._count.proposals}</TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {format.dateTime(g.createdAt, SHORT_DATE)}
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                    {t('gigs.empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AdminPager
        basePath={`/${params.locale}/admin/gigs`}
        query={{
          search: searchParams.search,
          status: searchParams.status,
          orgId: searchParams.orgId,
          agency: searchParams.agency,
        }}
        page={page}
        totalPages={totalPages}
        prevLabel={t('common.prev')}
        nextLabel={t('common.next')}
        pageLabel={t('common.pageOf', { page, totalPages })}
      />
    </div>
  )
}
