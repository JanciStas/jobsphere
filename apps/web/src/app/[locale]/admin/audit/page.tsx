import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireGlobalAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { queryAuditLogs, type AuditResource } from '@/lib/audit-log'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('adminAudit.title'),
  }
}

/**
 * The audit log, finally readable.
 *
 * `queryAuditLogs()` has existed in lib/audit-log.ts with no caller anywhere in
 * the app, and until the previous commit no admin route wrote an entry at all —
 * so the table it reads was empty of exactly the actions an administrator would
 * come here to check.
 *
 * Note the deliberate limit: queryAuditLogs offers no cursor and no total count,
 * so this is honestly "the most recent N" rather than a paginated view
 * pretending to be complete. Adding real paging means changing that helper,
 * which is a separate job.
 */
const PAGE_SIZE = 200

const RESOURCES: AuditResource[] = [
  'USER',
  'ORGANIZATION',
  'JOB',
  'APPLICATION',
  'CANDIDATE',
  'DSAR',
  'SETTING',
  'FEATURE_FLAG',
]

function isResource(value: string | undefined): value is AuditResource {
  return !!value && (RESOURCES as string[]).includes(value)
}

export default async function AdminAuditPage({
  params,
  searchParams,
}: {
  params: { locale: string }
  searchParams: { resource?: string; days?: string }
}) {
  const authResult = await requireGlobalAdmin()
  if (!authResult) {
    redirect(`/${params.locale}/login?error=forbidden`)
  }

  const t = await getTranslations('adminAudit')
  const days = Math.min(365, Math.max(1, Number(searchParams.days ?? '30') || 30))
  const startDate = new Date(Date.now() - days * 86_400_000)

  const logs = await queryAuditLogs({
    resource: isResource(searchParams.resource) ? searchParams.resource : undefined,
    startDate,
    limit: PAGE_SIZE,
  })

  // The actor is a user id on the row; resolve names in one query rather than
  // per row.
  const actorIds = [...new Set(logs.map((l) => l.userId).filter((id): id is string => !!id))]
  const actors = actorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      })
    : []
  const actorById = new Map(actors.map((a) => [a.id, a]))

  const filterHref = (resource?: string) => {
    const search = new URLSearchParams()
    if (resource) search.set('resource', resource)
    if (days !== 30) search.set('days', String(days))
    const qs = search.toString()
    return `/${params.locale}/admin/audit${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('intro', { count: PAGE_SIZE, days })}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={filterHref()}
          className={`rounded-full border px-3 py-1 text-xs ${
            !isResource(searchParams.resource) ? 'bg-muted font-medium' : ''
          }`}
        >
          {t('all')}
        </a>
        {RESOURCES.map((resource) => (
          <a
            key={resource}
            href={filterHref(resource)}
            className={`rounded-full border px-3 py-1 text-xs ${
              searchParams.resource === resource ? 'bg-muted font-medium' : ''
            }`}
          >
            {resource}
          </a>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('recordCount', { count: logs.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <div className="overflow-x-auto">
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
                  {logs.map((log) => {
                    const actor = log.userId ? actorById.get(log.userId) : null
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
                        <td className="max-w-md py-2 pr-4 font-mono text-xs">
                          {/* oldValues was never written before this work; rows
                              from earlier show only the right-hand side. */}
                          {log.oldValues ? (
                            <span className="text-muted-foreground">
                              {JSON.stringify(log.oldValues)} →{' '}
                            </span>
                          ) : null}
                          {JSON.stringify(log.newValues)}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {log.ipAddress ?? '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
