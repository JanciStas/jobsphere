import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireGlobalAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DsarActionButton } from './_components/dsar-action-button'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('adminGdpr.title'),
  }
}

/**
 * DSAR queue.
 *
 * `POST /api/admin/gdpr/dsar/[id]` has existed for a while with no page behind
 * it and no link anywhere, so the right to erasure could only be exercised by
 * hand-crafting an HTTP request. Nothing surfaced how long a request had been
 * waiting either, and the statutory window is 30 days.
 *
 * Age is therefore the column this page is really about: anything past 20 days
 * is flagged, because that is where there is still time to act.
 */
const WARN_AFTER_DAYS = 20
const DEADLINE_DAYS = 30

function ageInDays(from: Date): number {
  return Math.floor((Date.now() - from.getTime()) / 86_400_000)
}

export default async function AdminGdprPage({ params }: { params: { locale: string } }) {
  const authResult = await requireGlobalAdmin()
  if (!authResult) {
    redirect(`/${params.locale}/login?error=forbidden`)
  }

  const requests = await prisma.dSARRequest.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    take: 200,
  })

  const pending = requests.filter((r) => r.status === 'PENDING')
  const overdue = pending.filter((r) => ageInDays(r.createdAt) >= DEADLINE_DAYS)
  const dueSoon = pending.filter(
    (r) => ageInDays(r.createdAt) >= WARN_AFTER_DAYS && ageInDays(r.createdAt) < DEADLINE_DAYS,
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">GDPR žiadosti</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Žiadosti podľa čl. 15 a 17. Zákonná lehota je {DEADLINE_DAYS} dní od podania.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">Čakajúce</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold">{pending.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">
              Blíži sa lehota
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-amber-600">{dueSoon.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">Po lehote</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-red-600">{overdue.length}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Žiadosti</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Žiadne žiadosti.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-4">Podaná</th>
                    <th className="py-2 pr-4">Vek</th>
                    <th className="py-2 pr-4">Typ</th>
                    <th className="py-2 pr-4">E-mail</th>
                    <th className="py-2 pr-4">Stav</th>
                    <th className="py-2">Akcie</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => {
                    const age = ageInDays(request.createdAt)
                    const isPending = request.status === 'PENDING'
                    const ageClass =
                      isPending && age >= DEADLINE_DAYS
                        ? 'font-semibold text-red-600'
                        : isPending && age >= WARN_AFTER_DAYS
                          ? 'font-semibold text-amber-600'
                          : 'text-muted-foreground'

                    return (
                      <tr key={request.id} className="border-b align-middle last:border-0">
                        <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">
                          {request.createdAt.toISOString().slice(0, 10)}
                        </td>
                        <td className={`whitespace-nowrap py-2 pr-4 ${ageClass}`}>{age} dní</td>
                        <td className="py-2 pr-4">
                          <Badge variant="outline">{request.requestType}</Badge>
                        </td>
                        <td className="py-2 pr-4">{request.email}</td>
                        <td className="py-2 pr-4">
                          <Badge variant={isPending ? 'default' : 'secondary'}>
                            {request.status}
                          </Badge>
                        </td>
                        <td className="py-2">
                          {isPending ? (
                            <div className="flex flex-wrap gap-2">
                              {request.requestType === 'DELETE' && request.userId && (
                                <DsarActionButton
                                  requestId={request.id}
                                  action="EXECUTE_DELETE"
                                  label="Vymazať údaje"
                                  variant="destructive"
                                />
                              )}
                              <DsarActionButton
                                requestId={request.id}
                                action="MARK_COMPLETED"
                                label="Vybavené"
                              />
                              <DsarActionButton
                                requestId={request.id}
                                action="REJECT"
                                label="Zamietnuť"
                              />
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {request.completedAt?.toISOString().slice(0, 10) ?? '—'}
                              {request.rejectionReason ? ` · ${request.rejectionReason}` : ''}
                            </span>
                          )}
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
