'use client'

/**
 * Admin Users list: search, role/status filters, sorting and pagination.
 * All filter state lives in the URL, the server page re-queries on navigation.
 */

import { useState, useTransition } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SHORT_DATE, SHORT_DATE_TIME } from '@/lib/formats'
import { ADMIN_ROLES } from '@/lib/admin-users/roles'
import { USER_STATUS_FILTERS } from '@/lib/admin-users/list-query'
import type { AdminUserRow } from '@/lib/admin-users/list'
import { RoleBadges, StatusBadge } from './_components/badges'
import { Search, ChevronLeft, ChevronRight, Users, ArrowDown, ArrowUp } from 'lucide-react'

export interface UsersFilters {
  search: string
  role: string
  status: string
  sort: 'createdAt' | 'lastLoginAt'
  order: 'asc' | 'desc'
}

interface UsersClientProps {
  initialUsers: AdminUserRow[]
  total: number
  page: number
  limit: number
  filters: UsersFilters
  locale: string
}

const SELECT_CLASS =
  'h-10 rounded-md border border-input bg-background px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-ring'

export function UsersClient({
  initialUsers,
  total,
  page,
  limit,
  filters,
  locale,
}: UsersClientProps) {
  const router = useRouter()
  const format = useFormatter()
  const t = useTranslations('adminUsers')
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState(filters.search)

  const totalPages = Math.max(1, Math.ceil(total / limit))

  function navigate(next: Partial<UsersFilters> & { page?: number }) {
    const merged = { ...filters, search, ...next }
    const params = new URLSearchParams()
    if (merged.search) params.set('search', merged.search)
    if (merged.role) params.set('role', merged.role)
    if (merged.status) params.set('status', merged.status)
    if (merged.sort !== 'createdAt') params.set('sort', merged.sort)
    if (merged.order !== 'desc') params.set('order', merged.order)
    if (next.page && next.page > 1) params.set('page', String(next.page))
    const qs = params.toString()
    startTransition(() => {
      router.push(`/${locale}/admin/users${qs ? `?${qs}` : ''}`)
    })
  }

  function toggleSort(column: 'createdAt' | 'lastLoginAt') {
    if (filters.sort === column) {
      navigate({ sort: column, order: filters.order === 'desc' ? 'asc' : 'desc' })
    } else {
      navigate({ sort: column, order: 'desc' })
    }
  }

  function SortHeader({ column, label }: { column: 'createdAt' | 'lastLoginAt'; label: string }) {
    const active = filters.sort === column
    const Icon = filters.order === 'asc' ? ArrowUp : ArrowDown
    return (
      <th
        scope="col"
        aria-sort={active ? (filters.order === 'asc' ? 'ascending' : 'descending') : 'none'}
        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
      >
        <button
          type="button"
          onClick={() => toggleSort(column)}
          className="inline-flex items-center gap-1 uppercase hover:text-slate-800"
        >
          {label}
          {active && <Icon className="h-3 w-3" aria-hidden="true" />}
        </button>
      </th>
    )
  }

  const th = 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500'

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Users className="h-6 w-6" aria-hidden="true" />
          {t('list.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t('list.total', { count: total })}</p>
      </div>

      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          navigate({ search, page: 1 })
        }}
        className="flex flex-col gap-2 md:flex-row md:items-center"
      >
        <div className="relative md:w-80">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            aria-label={t('list.searchLabel')}
            placeholder={t('list.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label={t('filters.role')}
          className={SELECT_CLASS}
          value={filters.role}
          onChange={(e) => navigate({ role: e.target.value, page: 1 })}
        >
          <option value="">{t('filters.allRoles')}</option>
          {ADMIN_ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('filters.status')}
          className={SELECT_CLASS}
          value={filters.status}
          onChange={(e) => navigate({ status: e.target.value, page: 1 })}
        >
          <option value="">{t('filters.allStatuses')}</option>
          {USER_STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {t(`filters.statusOption.${s}`)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" disabled={isPending}>
          {t('list.search')}
        </Button>
      </form>

      <Card className="border border-slate-200 bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th scope="col" className={th}>
                    {t('table.name')}
                  </th>
                  <th scope="col" className={th}>
                    {t('table.email')}
                  </th>
                  <th scope="col" className={th}>
                    {t('table.roles')}
                  </th>
                  <th scope="col" className={th}>
                    {t('table.company')}
                  </th>
                  <th scope="col" className={th}>
                    {t('table.status')}
                  </th>
                  <SortHeader column="createdAt" label={t('table.registered')} />
                  <SortHeader column="lastLoginAt" label={t('table.lastLogin')} />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isPending
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 7 }).map((_, j) => (
                          <td key={j} className="px-4 py-4">
                            <Skeleton className="h-4 w-full" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : initialUsers.map((user) => (
                      <tr key={user.id} className="transition-colors hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <Link
                            href={`/${locale}/admin/users/${user.id}`}
                            className="max-w-[160px] truncate font-medium text-slate-900 hover:underline"
                          >
                            {user.name ?? <span className="italic text-slate-400">—</span>}
                          </Link>
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-3 text-slate-600">
                          {user.email}
                        </td>
                        <td className="px-4 py-3">
                          <RoleBadges roles={user.roles} />
                        </td>
                        <td className="max-w-[160px] truncate px-4 py-3 text-slate-600">
                          {user.company ?? '—'}
                          {user.orgCount > 1 && (
                            <span className="ml-1 text-xs text-slate-400">
                              +{user.orgCount - 1}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={user.status} unverified={!user.emailVerified} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                          {format.dateTime(new Date(user.createdAt), SHORT_DATE)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                          {user.lastLoginAt
                            ? format.dateTime(new Date(user.lastLoginAt), SHORT_DATE_TIME)
                            : t('table.never')}
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>

            {!isPending && initialUsers.length === 0 && (
              <div className="px-6 py-16 text-center text-sm text-slate-500">{t('list.empty')}</div>
            )}
          </div>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {t('list.pagination', { page, totalPages, total })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isPending}
              onClick={() => navigate({ page: page - 1 })}
            >
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
              {t('list.previous')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || isPending}
              onClick={() => navigate({ page: page + 1 })}
            >
              {t('list.next')}
              <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
