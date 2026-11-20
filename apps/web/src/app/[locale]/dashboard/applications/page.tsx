import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getFormatter, getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SHORT_DATE } from '@/lib/formats'

export const dynamic = 'force-dynamic'

const KNOWN_STAGES = ['NEW', 'SCREENING', 'PHONE', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'candidateDashboard' })
  return { title: t('applicationsPage.title') }
}

export default async function ApplicationsPage({ params }: { params: { locale: string } }) {
  const session = await auth()
  if (!session?.user?.id) redirect(`/${params.locale}/login/candidate`)

  const t = await getTranslations({ locale: params.locale, namespace: 'candidateDashboard' })
  const format = await getFormatter({ locale: params.locale })

  // Own applications only (Candidate is org-scoped; resolve through the user link).
  const applications = await prisma.application.findMany({
    where: { candidate: { userId: session.user.id } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
    select: {
      id: true,
      stage: true,
      createdAt: true,
      job: {
        select: { id: true, title: true, city: true, organization: { select: { name: true } } },
      },
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('applicationsPage.title')}</h1>
        <p className="text-muted-foreground">{t('applicationsPage.subtitle')}</p>
      </div>
      {applications.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 py-10 text-center">
            <p className="text-muted-foreground">{t('noApplications')}</p>
            <Button asChild>
              <Link href={`/${params.locale}/jobs`}>{t('browseJobs')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {applications.map((app) => (
            <Card key={app.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div className="min-w-0">
                  <Link
                    href={`/${params.locale}/dashboard/applications/${app.id}`}
                    className="font-semibold hover:underline"
                  >
                    {app.job.title}
                  </Link>
                  <p className="text-sm text-muted-foreground">
                    {app.job.organization.name}
                    {app.job.city && ` · ${app.job.city}`}
                    {' · '}
                    {t('appliedOn', { date: format.dateTime(app.createdAt, SHORT_DATE) })}
                  </p>
                </div>
                <Badge variant={app.stage === 'REJECTED' ? 'destructive' : 'secondary'}>
                  {KNOWN_STAGES.includes(app.stage) ? t(`stage.${app.stage}`) : app.stage}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
