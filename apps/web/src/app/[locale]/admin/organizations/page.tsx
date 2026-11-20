import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { SHORT_DATE } from '@/lib/formats'
import Link from 'next/link'
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
import { OrgActionButton } from './_components/org-action-button'
import { EditOrgDialog } from './_components/edit-org-dialog'
import { CreateOrgButton } from './_components/create-org-button'
import type { Metadata } from 'next'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'admin' })
  return { title: t('organizations.metaTitle') }
}

export default async function AdminOrganizationsPage({ params }: { params: { locale: string } }) {
  const session = await auth()
  const format = await getFormatter()
  const t = await getTranslations('admin')
  const tm = await getTranslations('adminMarketplace')
  if (!session?.user?.isGlobalAdmin) {
    redirect(`/${params.locale}/login?error=forbidden`)
  }

  const orgs = await prisma.organization.findMany({
    // Explicit `undefined` opts out of the soft-delete middleware default so
    // suspended organisations stay listed (otherwise they could never be re-activated).
    where: { deletedAt: undefined },
    select: {
      id: true,
      name: true,
      slug: true,
      industry: true,
      size: true,
      website: true,
      createdAt: true,
      deletedAt: true,
      // Agency = at least one active member with the AGENCY role.
      users: { where: { role: 'AGENCY', deletedAt: null }, select: { userId: true }, take: 1 },
      _count: {
        select: {
          users: true,
          jobs: true,
          subscriptions: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('organizations.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('organizations.totalCount', { count: orgs.length })}
          </p>
        </div>
        <CreateOrgButton />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('organizations.allOrganizations')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('organizations.table.name')}</TableHead>
                <TableHead>{t('common.slug')}</TableHead>
                <TableHead>{t('organizations.table.industry')}</TableHead>
                <TableHead className="text-right">{t('organizations.table.members')}</TableHead>
                <TableHead className="text-right">{t('organizations.table.jobs')}</TableHead>
                <TableHead className="text-right">
                  {t('organizations.table.subscriptions')}
                </TableHead>
                <TableHead>{t('common.state')}</TableHead>
                <TableHead>{t('common.date')}</TableHead>
                <TableHead className="text-right">{t('common.action')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orgs.map((org) => {
                const suspended = org.deletedAt !== null
                return (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/${params.locale}/admin/organizations/${org.id}`}
                        className="text-blue-600 hover:underline"
                      >
                        {org.name}
                      </Link>
                      {org.users.length > 0 ? (
                        <Badge variant="outline" className="ml-2">
                          {tm('organizations.agency')}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="ml-2">
                          {tm('organizations.company')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">{org.slug}</TableCell>
                    <TableCell className="text-sm text-slate-500">{org.industry ?? '—'}</TableCell>
                    <TableCell className="text-right text-sm">{org._count.users}</TableCell>
                    <TableCell className="text-right text-sm">{org._count.jobs}</TableCell>
                    <TableCell className="text-right text-sm">{org._count.subscriptions}</TableCell>
                    <TableCell>
                      {suspended ? (
                        <Badge variant="destructive">{t('organizations.suspended')}</Badge>
                      ) : (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                          {t('organizations.active')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-slate-500">
                      {format.dateTime(org.createdAt, SHORT_DATE)}
                    </TableCell>
                    <TableCell className="text-right">
                      <EditOrgDialog
                        orgId={org.id}
                        slug={org.slug}
                        name={org.name}
                        industry={org.industry}
                        size={org.size}
                        website={org.website}
                      />
                      <OrgActionButton orgId={org.id} suspended={suspended} />
                    </TableCell>
                  </TableRow>
                )
              })}
              {orgs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-slate-500">
                    {t('organizations.empty')}
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
