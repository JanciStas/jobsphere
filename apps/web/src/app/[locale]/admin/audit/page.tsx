import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Download } from 'lucide-react'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AUDIT_EXPORT_LIMIT,
  diffJson,
  parseAuditFilters,
  queryAuditPage,
  type AuditFilters,
} from '@/lib/admin/audit-query'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return { title: t('adminAudit.title') }
}

const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

async function distinctValues(field: 'action' | 'entityType'): Promise<string[]> {
  try {
    const rows = await prisma.auditLog.findMany({
      distinct: [field],
      select: { action: true, entityType: true },
      orderBy: { [field]: 'asc' },
      take: 200,
    })
    return rows.map((r) => r[field]).filter((v): v is string => !!v)
  } catch (error) {
    logger.error('Admin audit: distinct filter values failed', error)
    return []
  }
}

function queryString(f: AuditFilters, page?: number): string {
  const sp = new URLSearchParams()
  if (f.action) sp.set('action', f.action)
  if (f.entityType) sp.set('entityType', f.entityType)
  if (f.user) sp.set('user', f.user)
  if (f.from) sp.set('from', f.from)
  if (f.to) sp.set('to', f.to)
  if (page && page > 1) sp.set('page', String(page))
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

export default async function AdminAuditPage({
  params,
  searchParams,
}: {
  params: { locale: string }
  searchParams: Record<string, string | string[] | undefined>
}) {
  const session = await auth()
  if (!session?.user?.isGlobalAdmin) redirect(`/${params.locale}/login/admin?error=forbidden`)

  const t = await getTranslations('adminCore.audit')
  const filters = parseAuditFilters(searchParams)

  const [actions, entityTypes, result] = await Promise.all([
    distinctValues('action'),
    distinctValues('entityType'),
    queryAuditPage(filters).catch((error) => {
      logger.error('Admin audit: query failed', error)
      return null
    }),
  ])

  const base = `/${params.locale}/admin/audit`
  const rows = result?.rows ?? []

  const actorIds = [...new Set(rows.map((l) => l.userId).filter((id): id is string => !!id))]
  const actors = actorIds.length
    ? await prisma.user
        .findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, email: true },
        })
        .catch(() => [])
    : []
  const actorById = new Map(actors.map((a) => [a.id, a]))

  const page = Math.min(filters.page, result?.pageCount ?? 1)
  const exportHref = `/api/admin/audit/export${queryString(filters)}`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={exportHref} download>
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('exportCsv')}
          </a>
        </Button>
      </div>
      <p className="-mt-4 text-xs text-muted-foreground">
        {t('exportNote', { limit: AUDIT_EXPORT_LIMIT })}
      </p>

      <form
        method="get"
        action={base}
        className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5"
      >
        <label className="space-y-1 text-xs font-medium">
          {t('filters.action')}
          <select
            name="action"
            defaultValue={filters.action ?? ''}
            className="h-10 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">{t('filters.all')}</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          {t('filters.entityType')}
          <select
            name="entityType"
            defaultValue={filters.entityType ?? ''}
            className="h-10 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">{t('filters.all')}</option>
            {entityTypes.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium">
          {t('filters.user')}
          <input
            name="user"
            type="text"
            maxLength={200}
            defaultValue={filters.user ?? ''}
            placeholder={t('filters.userPlaceholder')}
            className="h-10 w-full rounded-md border bg-background px-2 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs font-medium">
          {t('filters.from')}
          <input
            name="from"
            type="date"
            defaultValue={filters.from ?? ''}
            className="h-10 w-full rounded-md border bg-background px-2 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs font-medium">
          {t('filters.to')}
          <input
            name="to"
            type="date"
            defaultValue={filters.to ?? ''}
            className="h-10 w-full rounded-md border bg-background px-2 text-sm"
          />
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
          <Button type="submit" size="sm">
            {t('filters.apply')}
          </Button>
          <Button asChild type="button" size="sm" variant="ghost">
            <a href={base}>{t('filters.reset')}</a>
          </Button>
        </div>
      </form>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-base font-semibold">
          {t('recordCount', { count: result?.total ?? 0 })}
        </h2>
        {result === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('loadError')}</p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">{t('colWhen')}</th>
                  <th className="py-2 pr-4">{t('colWho')}</th>
                  <th className="py-2 pr-4">{t('colAction')}</th>
                  <th className="py-2 pr-4">{t('colWhat')}</th>
                  <th className="py-2 pr-4">{t('colChange')}</th>
                  <th className="py-2">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => {
                  const actor = log.userId ? actorById.get(log.userId) : null
                  const diff = diffJson(log.oldValues, log.newValues)
                  return (
                    <tr key={log.id} className="border-b align-top last:border-0">
                      <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">
                        {log.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="py-2 pr-4">
                        {actor ? (
                          <span title={actor.email}>{actor.name || actor.email}</span>
                        ) : (
                          <span className="text-muted-foreground">{log.userId ?? '—'}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge variant="secondary">{log.action}</Badge>
                      </td>
                      <td className="py-2 pr-4">
                        <span className="text-muted-foreground">{log.entityType}</span>{' '}
                        <span className="font-mono text-xs">{log.entityId}</span>
                      </td>
                      <td className="max-w-md py-2 pr-4 text-xs">
                        {diff.length === 0 ? (
                          <span className="text-muted-foreground">{t('noChanges')}</span>
                        ) : (
                          <details>
                            <summary className="cursor-pointer text-primary">
                              {t('details', { count: diff.length })}
                            </summary>
                            <ul className="mt-2 space-y-1 font-mono">
                              {diff.map((d) => (
                                <li key={d.key} className="break-all">
                                  <span className="font-semibold">{d.key}</span>{' '}
                                  <span className="text-muted-foreground">
                                    ({t(`kind.${d.kind}`)})
                                  </span>
                                  {d.kind !== 'added' && (
                                    <div className="text-red-700 dark:text-red-400">
                                      − {fmt(d.before)}
                                    </div>
                                  )}
                                  {d.kind !== 'removed' && (
                                    <div className="text-emerald-700 dark:text-emerald-400">
                                      + {fmt(d.after)}
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">{log.ipAddress ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {result && result.pageCount > 1 && (
          <nav
            aria-label={t('pagination')}
            className="mt-4 flex items-center justify-between text-sm"
          >
            {page > 1 ? (
              <a
                className="text-primary hover:underline"
                href={`${base}${queryString(filters, page - 1)}`}
              >
                {t('prev')}
              </a>
            ) : (
              <span />
            )}
            <span className="text-muted-foreground">
              {t('pageOf', { page, pages: result.pageCount })}
            </span>
            {page < result.pageCount ? (
              <a
                className="text-primary hover:underline"
                href={`${base}${queryString(filters, page + 1)}`}
              >
                {t('next')}
              </a>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </div>
  )
}
