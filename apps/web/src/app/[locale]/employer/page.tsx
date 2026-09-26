import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveActiveMembership } from '@/lib/api-helpers'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SHORT_DATE } from '@/lib/formats'
import {
  Plus,
  Briefcase,
  Users,
  Kanban,
  CheckCircle,
  Clock,
  XCircle,
  Eye,
  CalendarClock,
  BarChart3,
  Mail,
  FileText,
} from 'lucide-react'
import { APPLICATION_STAGES, STAGE_COLORS } from '@/lib/constants/application-stages'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return { title: t('employer.title'), description: t('employer.description') }
}

async function getEmployerData(userId: string, activeOrgId?: string | null) {
  // Get user's organization
  const userOrgRole = await resolveActiveMembership(userId, activeOrgId, {
    organization: true,
  })

  if (!userOrgRole) {
    return null
  }

  // Get jobs for this organization
  const jobs = await prisma.job.findMany({
    where: {
      orgId: userOrgRole.orgId,
    },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      viewCount: true,
      _count: {
        select: { applications: true },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 10,
  })

  // Get recent applications
  const recentApplications = await prisma.application.findMany({
    // Scope on Application.orgId (own column) so @@index([orgId, stage, createdAt])
    // can serve this instead of joining Job.
    where: {
      orgId: userOrgRole.orgId,
    },
    include: {
      job: {
        select: {
          title: true,
        },
      },
      candidate: {
        include: {
          contacts: {
            where: {
              isPrimary: true,
            },
            take: 1,
          },
        },
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: 5,
  })

  return {
    organization: userOrgRole.organization,
    jobs,
    recentApplications,
  }
}

export default async function EmployerDashboardPage({ params }: { params: { locale: string } }) {
  const session = await auth()
  const format = await getFormatter()
  const t = await getTranslations({ locale: params.locale, namespace: 'employer' })
  const tCommon = await getTranslations({ locale: params.locale, namespace: 'common' })
  const tStages = await getTranslations({ locale: params.locale, namespace: 'employer.stages' })

  if (!session?.user?.id) {
    redirect(`/${params.locale}/login`)
  }

  const data = await getEmployerData(session.user.id, session.user.activeOrgId)

  if (!data) {
    // User is not an employer
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background to-muted/30">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>{t('accessDenied')}</CardTitle>
            <CardDescription>{t('noAccess')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="w-full">
              <Link href={`/${params.locale}/dashboard`}>{t('backToDashboard')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const { organization, jobs, recentApplications } = data

  type JobWithApplications = typeof jobs extends (infer T)[] ? T : never
  type ApplicationWithRelations = typeof recentApplications extends (infer T)[] ? T : never

  // Calculate stats
  const stats = {
    activeJobs: jobs.filter((j: JobWithApplications) => j.status === 'PUBLISHED').length,
    totalApplicants: jobs.reduce(
      (sum: number, job: JobWithApplications) => sum + job._count.applications,
      0,
    ),
    newApplicants: recentApplications.filter((a: ApplicationWithRelations) => a.stage === 'NEW')
      .length,
    totalJobs: jobs.length,
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <Badge variant="default" className="gap-1 bg-green-600">
            <CheckCircle className="h-3 w-3" /> {tCommon('status.active')}
          </Badge>
        )
      case 'DRAFT':
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" /> {tCommon('status.draft')}
          </Badge>
        )
      case 'CLOSED':
        return (
          <Badge variant="outline" className="gap-1">
            <XCircle className="h-3 w-3" /> {tCommon('status.closed')}
          </Badge>
        )
      default:
        return <Badge>{status}</Badge>
    }
  }

  const getApplicantStatusBadge = (status: string) => {
    const label = (APPLICATION_STAGES as readonly string[]).includes(status)
      ? tStages(status)
      : status
    const colorClass = STAGE_COLORS[status as keyof typeof STAGE_COLORS]
    if (colorClass) {
      return <Badge className={colorClass}>{label}</Badge>
    }
    return <Badge>{label}</Badge>
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold">
              {organization.name} - {t('dashboard')}
            </h1>
            <p className="text-muted-foreground">{t('manage')}</p>
          </div>
          <Button asChild>
            <Link href={`/${params.locale}/employer/jobs/new`}>
              <Plus className="mr-2 h-4 w-4" />
              {t('newPosition')}
            </Link>
          </Button>
        </div>

        {/* Stats */}
        <div className="mb-8 grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>{t('activePositions')}</CardDescription>
              <CardTitle className="text-3xl">{stats.activeJobs}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>{t('totalApplications')}</CardDescription>
              <CardTitle className="text-3xl">{stats.totalApplicants}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>{t('newApplications')}</CardDescription>
              <CardTitle className="text-3xl text-blue-600">{stats.newApplicants}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardDescription>{t('totalPositions')}</CardDescription>
              <CardTitle className="text-3xl text-muted-foreground">{stats.totalJobs}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="space-y-6 lg:col-span-2">
            {/* Active Jobs */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t('positions')}</CardTitle>
                    <CardDescription>{t('published')}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {jobs.map((job: JobWithApplications) => (
                    <div
                      key={job.id}
                      className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex-1">
                        <div className="mb-2 flex items-center gap-2">
                          <h3 className="font-semibold">{job.title}</h3>
                          {getStatusBadge(job.status)}
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Users className="h-4 w-4" />
                            {t('applicationsCount', { count: job._count.applications })}
                          </span>
                          <span className="flex items-center gap-1">
                            <Eye className="h-4 w-4" />
                            {t('viewsCount', { count: job.viewCount })}
                          </span>
                          <span>
                            {t('created')} {format.dateTime(job.createdAt, SHORT_DATE)}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/${params.locale}/jobs/${job.id}`}>{t('view')}</Link>
                        </Button>
                        <Button variant="default" size="sm" asChild>
                          <Link href={`/${params.locale}/employer/jobs/${job.id}/edit`}>
                            {t('edit')}
                          </Link>
                        </Button>
                      </div>
                    </div>
                  ))}

                  {jobs.length === 0 && (
                    <div className="py-8 text-center">
                      <Briefcase className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
                      <p className="mb-4 text-muted-foreground">{t('noPositions')}</p>
                      <Button asChild>
                        <Link href={`/${params.locale}/employer/jobs/new`}>
                          <Plus className="mr-2 h-4 w-4" />
                          {t('createFirst')}
                        </Link>
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Recent Applicants */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t('recent')}</CardTitle>
                    <CardDescription>{t('lastApplied')}</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/${params.locale}/employer/applicants`}>{t('viewAll')}</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentApplications.map((application: ApplicationWithRelations) => (
                    <div
                      key={application.id}
                      className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <h4 className="font-semibold">
                            {application.candidate.contacts?.[0]?.fullName ||
                              application.candidate.contacts?.[0]?.email ||
                              t('candidate')}
                          </h4>
                          {getApplicantStatusBadge(application.stage)}
                        </div>
                        <p className="mb-1 text-sm text-muted-foreground">
                          {application.job.title}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>
                            {t('applied')} {format.dateTime(application.createdAt, SHORT_DATE)}
                          </span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/${params.locale}/employer/applicants/${application.id}`}>
                          {t('detail')}
                        </Link>
                      </Button>
                    </div>
                  ))}

                  {recentApplications.length === 0 && (
                    <div className="py-8 text-center text-muted-foreground">
                      <Users className="mx-auto mb-3 h-12 w-12" />
                      <p>{t('noApplications')}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <Card>
              <CardHeader>
                <CardTitle>{t('quickActions')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button className="w-full justify-start" variant="outline" asChild>
                  <Link href={`/${params.locale}/employer/jobs/new`}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t('createNew')}
                  </Link>
                </Button>
                <Button className="w-full justify-start" variant="outline" asChild>
                  <Link href={`/${params.locale}/employer/applicants`}>
                    <Users className="mr-2 h-4 w-4" />
                    {t('viewAllCandidates')}
                  </Link>
                </Button>
                <Button className="w-full justify-start" variant="outline" asChild>
                  <Link href={`/${params.locale}/employer/pipeline`}>
                    <Kanban className="mr-2 h-4 w-4" />
                    {t('pipeline.title')}
                  </Link>
                </Button>
                <Button className="w-full justify-start" variant="outline" asChild>
                  <Link href={`/${params.locale}/employer/calendar`}>
                    <CalendarClock className="mr-2 h-4 w-4" />
                    {t('calendar.title')}
                  </Link>
                </Button>
                <Button className="w-full justify-start" variant="outline" asChild>
                  <Link href={`/${params.locale}/employer/gigs`}>
                    <Briefcase className="mr-2 h-4 w-4" />
                    {t('gigs.title')}
                  </Link>
                </Button>
                {/* Analytics, sequences and assessments were reachable only by
                    typing the URL — nothing in the app linked to them. */}
                <Button className="w-full justify-start" variant="outline" asChild>
                  <Link href={`/${params.locale}/employer/tasks`}>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Úlohy a pripomienky
                  </Link>
                </Button>
                <Button className="w-full justify-start" variant="outline" asChild>
                  <Link href={`/${params.locale}/employer/analytics`}>
                    <BarChart3 className="mr-2 h-4 w-4" />
                    Štatistiky náboru
                  </Link>
                </Button>
                <Button className="w-full justify-start" variant="outline" asChild>
                  <Link href={`/${params.locale}/employer/sequences`}>
                    <Mail className="mr-2 h-4 w-4" />
                    E-mailové sekvencie
                  </Link>
                </Button>
                <Button className="w-full justify-start" variant="outline" asChild>
                  <Link href={`/${params.locale}/employer/assessments`}>
                    <FileText className="mr-2 h-4 w-4" />
                    Testy zručností
                  </Link>
                </Button>
                <Button className="w-full justify-start" variant="outline" asChild>
                  <Link href={`/${params.locale}/employer/settings`}>
                    <Briefcase className="mr-2 h-4 w-4" />
                    {t('companySettings')}
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Tips */}
            <Card>
              <CardHeader>
                <CardTitle>{t('tips')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="mb-1 font-medium">✨ {t('useAI')}</p>
                  <p className="text-xs text-muted-foreground">{t('aiDesc')}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="mb-1 font-medium">📝 {t('detailedDesc')}</p>
                  <p className="text-xs text-muted-foreground">{t('descHelp')}</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="mb-1 font-medium">⚡ {t('quickResponse')}</p>
                  <p className="text-xs text-muted-foreground">{t('responseHelp')}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
