/**
 * Admin Users Page (Server Component)
 * Re-checks isGlobalAdmin itself (the layout guard is not enough on its own),
 * loads the filtered page server-side and hands it to UsersClient.
 */

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { listAdminUsers } from '@/lib/admin-users/list'
import { listQuerySchema, parseListQuery } from '@/lib/admin-users/list-query'
import { UsersClient } from './users-client'

interface PageProps {
  params: { locale: string }
  searchParams: Record<string, string | string[] | undefined>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'adminUsers' })
  return { title: t('list.metaTitle') }
}

export default async function AdminUsersPage({ params, searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user?.isGlobalAdmin) redirect(`/${params.locale}/login?error=forbidden`)

  // Garbage in the URL falls back to the defaults instead of an error page.
  const parsed = parseListQuery(searchParams)
  const query = parsed.success ? parsed.data : listQuerySchema.parse({})

  const { users, total, page, limit } = await listAdminUsers(query)

  return (
    <UsersClient
      initialUsers={users}
      total={total}
      page={page}
      limit={limit}
      filters={{
        search: query.search ?? '',
        role: query.role ?? '',
        status: query.status ?? '',
        sort: query.sort,
        order: query.order,
      }}
      locale={params.locale}
    />
  )
}
