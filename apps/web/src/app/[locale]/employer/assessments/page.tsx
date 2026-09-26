import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FileText, Plus, BarChart3 } from 'lucide-react'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('assessments.title'),
    description: t('assessments.description'),
  }
}

/**
 * The assessment list.
 *
 * This page did not exist, which broke two navigation paths that pointed at it:
 * the builder redirects here after saving (`assessment-builder-client.tsx`) and
 * the results page's "Back" button links here. Both landed on a 404, so creating
 * an assessment appeared to fail even when it had been saved.
 */
export default async function AssessmentsPage({ params }: { params: { locale: string } }) {
  const session = await auth()

  if (!session?.user?.id) {
    redirect(`/${params.locale}/login`)
  }

  const t = await getTranslations('employer.assessments')

  const membership = await prisma.userOrgRole.findFirst({
    where: { userId: session.user.id },
    select: { orgId: true },
  })

  if (!membership) {
    redirect(`/${params.locale}/employer`)
  }

  // `deletedAt: null` written out: Assessment is not one of the five models the
  // soft-delete middleware in lib/prisma.ts covers.
  const assessments = await prisma.assessment.findMany({
    where: { orgId: membership.orgId, deletedAt: null },
    select: {
      id: true,
      name: true,
      description: true,
      durationMin: true,
      isPublished: true,
      createdAt: true,
      _count: { select: { sections: true, invites: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <div className="container mx-auto py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button asChild>
          <Link href={`/${params.locale}/employer/assessments/builder`}>
            <Plus className="mr-2 h-4 w-4" />
            {t('create')}
          </Link>
        </Button>
      </div>

      {assessments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <FileText className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">{t('emptyTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('emptyDescription')}</p>
            </div>
            <Button asChild>
              <Link href={`/${params.locale}/employer/assessments/builder`}>{t('create')}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {assessments.map((assessment) => (
            <Card key={assessment.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{assessment.name}</CardTitle>
                  <Badge variant={assessment.isPublished ? 'default' : 'secondary'}>
                    {assessment.isPublished ? t('published') : t('draft')}
                  </Badge>
                </div>
                {assessment.description && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {assessment.description}
                  </p>
                )}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-end gap-3">
                <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <div>{t('sectionCount', { count: assessment._count.sections })}</div>
                  <div>{t('inviteCount', { count: assessment._count.invites })}</div>
                  {assessment.durationMin && (
                    <div>{t('duration', { minutes: assessment.durationMin })}</div>
                  )}
                </dl>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/${params.locale}/employer/assessments/${assessment.id}/results`}>
                    <BarChart3 className="mr-2 h-4 w-4" />
                    {t('viewResults')}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
