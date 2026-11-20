import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { SHORT_DATE } from '@/lib/formats'
import { auth } from '@/lib/auth'
import { listFreelancers, AVAILABILITIES } from '@/lib/admin-marketplace'
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
  return { title: t('freelancers.metaTitle') }
}

const FIELD = 'h-9 rounded-md border border-input bg-background px-3 text-sm'
const LIMIT = 25

export default async function AdminFreelancersPage({
  params,
  searchParams,
}: {
  params: { locale: string }
  searchParams: { search?: string; visible?: string; availability?: string; page?: string }
}) {
  const session = await auth()
  const format = await getFormatter()
  const t = await getTranslations('adminMarketplace')
  if (!session?.user?.isGlobalAdmin) {
    redirect(`/${params.locale}/login?error=forbidden`)
  }

  const page = Math.max(1, Math.floor(Number(searchParams.page ?? '1')) || 1)
  const { items, total } = await listFreelancers({
    search: searchParams.search,
    visible: searchParams.visible,
    availability: searchParams.availability,
    page,
    limit: LIMIT,
  })
  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{t('freelancers.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t('freelancers.totalCount', { count: total })}
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          name="search"
          defaultValue={searchParams.search ?? ''}
          placeholder={t('freelancers.searchPlaceholder')}
          aria-label={t('common.search')}
          className={`${FIELD} w-64`}
        />
        <select
          name="visible"
          defaultValue={searchParams.visible ?? ''}
          aria-label={t('freelancers.visibility')}
          className={FIELD}
        >
          <option value="">{t('freelancers.visibilityAll')}</option>
          <option value="true">{t('freelancers.visible')}</option>
          <option value="false">{t('freelancers.hidden')}</option>
        </select>
        <select
          name="availability"
          defaultValue={searchParams.availability ?? ''}
          aria-label={t('freelancers.availability')}
          className={FIELD}
        >
          <option value="">{t('freelancers.availabilityAll')}</option>
          {AVAILABILITIES.map((a) => (
            <option key={a} value={a}>
              {t(`availabilityLabels.${a}`)}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm">
          {t('common.apply')}
        </Button>
        <Button asChild type="button" variant="outline" size="sm">
          <Link href={`/${params.locale}/admin/freelancers`}>{t('common.reset')}</Link>
        </Button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('freelancers.allFreelancers')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('freelancers.table.name')}</TableHead>
                <TableHead>{t('freelancers.table.services')}</TableHead>
                <TableHead>{t('freelancers.table.rate')}</TableHead>
                <TableHead>{t('freelancers.table.availability')}</TableHead>
                <TableHead>{t('freelancers.table.visibility')}</TableHead>
                <TableHead className="text-right">{t('freelancers.table.proposals')}</TableHead>
                <TableHead>{t('common.created')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <Link
                      href={`/${params.locale}/admin/freelancers/${f.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {f.user.name ?? f.user.email}
                    </Link>
                    <p className="text-xs text-slate-500">{f.user.email}</p>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-slate-500">
                    {f.title ?? '—'}
                    {f.services.length > 0 && ` · ${f.services.slice(0, 3).join(', ')}`}
                  </TableCell>
                  <TableCell className="text-sm">
                    {f.hourlyRate != null ? `${f.hourlyRate} ${f.currency}` : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`availabilityLabels.${f.availability}`)}</Badge>
                  </TableCell>
                  <TableCell>
                    {f.visible ? (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                        {t('freelancers.visible')}
                      </Badge>
                    ) : (
                      <Badge variant="destructive">{t('freelancers.hidden')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">{f._count.proposals}</TableCell>
                  <TableCell className="text-sm text-slate-500">
                    {format.dateTime(f.createdAt, SHORT_DATE)}
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-slate-500">
                    {t('freelancers.empty')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AdminPager
        basePath={`/${params.locale}/admin/freelancers`}
        query={{
          search: searchParams.search,
          visible: searchParams.visible,
          availability: searchParams.availability,
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
