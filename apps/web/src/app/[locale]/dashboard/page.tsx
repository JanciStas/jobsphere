import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { auth } from '@/lib/auth'
import DashboardClient from './dashboard-client'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

type DashboardSearchParams = Record<string, string | string[] | undefined>

/**
 * `app/[locale]/employer/layout.tsx` redirects here with
 * `?error=no_organization` when a signed-in user without an organization opens
 * the employer area. Nothing used to read that param, so the user silently
 * bounced back to the dashboard with no explanation.
 */
async function buildRedirectNotice(locale: string, searchParams?: DashboardSearchParams) {
  const rawError = searchParams?.error
  const error = Array.isArray(rawError) ? rawError[0] : rawError
  if (error !== 'no_organization') return null

  const t = await getTranslations({ locale, namespace: 'employer' })
  return (
    <Alert>
      <Building2 className="h-4 w-4" />
      <AlertTitle>{t('accessDenied')}</AlertTitle>
      <AlertDescription>{t('noAccess')}</AlertDescription>
    </Alert>
  )
}

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return { title: t('dashboard.title'), description: t('dashboard.description') }
}

async function getDashboardData() {
  const session = await auth()
  if (!session?.user?.id) {
    return null
  }

  // Import prisma dynamically to avoid build issues
  const { prisma } = await import('@/lib/prisma')

  // Fetch dashboard data sequentially to avoid pgBouncer prepared statement conflicts
  // (pgBouncer transaction mode + Promise.all causes 42P05: prepared statement already exists)

  // Get user details
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      avatar: true,
    },
  })

  // Get recent applications (Candidate is org-scoped; resolve via the user link)
  const applications = await prisma.application.findMany({
    where: { candidate: { userId: session.user.id } },
    include: {
      job: {
        include: {
          organization: {
            select: {
              name: true,
              logo: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  // Get first resume (since isDefault field doesn't exist)
  const resume = await prisma.resume.findFirst({
    where: {
      candidate: { userId: session.user.id },
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      sections: true,
    },
  })

  // Get recommended jobs (simplified server-side version)
  const recommendedJobs = await prisma.job.findMany({
    where: {
      status: 'PUBLISHED',
    },
    include: {
      organization: {
        select: {
          name: true,
          logo: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })

  const savedCount = await prisma.savedJob.count({ where: { userId: session.user.id } })
  const totalApplications = await prisma.application.count({
    where: { candidate: { userId: session.user.id } },
  })
  const inProcessApplications = await prisma.application.count({
    where: {
      candidate: { userId: session.user.id },
      stage: { notIn: ['HIRED', 'REJECTED'] },
    },
  })

  // Calculate stats
  const stats = {
    saved: savedCount,
    inProcess: inProcessApplications,
    total: totalApplications,
    pending: applications.filter((a) => a.stage === 'NEW').length,
    reviewing: applications.filter((a) => a.stage === 'SCREENING' || a.stage === 'INTERVIEW')
      .length,
    accepted: applications.filter((a) => a.stage === 'HIRED').length,
    rejected: applications.filter((a) => a.stage === 'REJECTED').length,
  }

  // Calculate profile completion
  let profileCompletion = 0
  const profileSteps = {
    basicInfo: false,
    cvUploaded: false,
    skills: false,
    preferences: false,
  }

  if (user?.name) {
    profileSteps.basicInfo = true
    profileCompletion += 25
  }

  if (resume) {
    profileSteps.cvUploaded = true
    profileCompletion += 25
  }

  // Check if resume has skills (skills are in Resume, not in ResumeSection)
  if (resume?.skills && resume.skills.length > 0) {
    profileSteps.skills = true
    profileCompletion += 25
  }

  // For now, mark preferences as not completed since these fields don't exist in the schema
  // This could be extended later with actual preference fields
  profileSteps.preferences = false

  // Format applications
  const formattedApplications = applications.map((app) => ({
    id: app.id,
    jobTitle: app.job.title,
    company: app.job.organization.name,
    companyLogo: app.job.organization.logo,
    status: app.stage as string,
    appliedAt: app.createdAt.toISOString(),
    location: app.job.city || '',
    jobId: app.job.id,
  }))

  // Format recommended jobs with basic scoring
  const formattedJobs = recommendedJobs.map((job, index) => ({
    id: job.id,
    title: job.title,
    company: job.organization.name,
    companyLogo: job.organization.logo,
    location: job.city || '',
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    type: job.employmentType,
    // Simple decreasing match score
    match: 95 - index * 5,
  }))

  return {
    user: {
      name: user?.name || 'User',
      email: user?.email || '',
      avatarUrl: user?.avatar,
    },
    stats,
    profileCompletion,
    profileSteps,
    applications: formattedApplications,
    recommendedJobs: formattedJobs,
  }
}

function DashboardLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="mb-2 h-9 w-64 animate-pulse rounded bg-muted" />
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
        </div>
        <div className="mb-8 grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="mb-2 h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-8 w-16 animate-pulse rounded bg-muted" />
              </CardHeader>
            </Card>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="h-6 w-32 animate-pulse rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="rounded-lg border p-4">
                      <div className="mb-2 h-5 w-48 animate-pulse rounded bg-muted" />
                      <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          <div>
            <Card>
              <CardHeader>
                <div className="h-6 w-24 animate-pulse rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="h-32 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: { locale: string }
  searchParams?: DashboardSearchParams
}) {
  const session = await auth()
  if (!session) {
    redirect(`/${params.locale}/login`)
  }

  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent params={params} searchParams={searchParams} />
    </Suspense>
  )
}

async function DashboardContent({
  params,
  searchParams,
}: {
  params: { locale: string }
  searchParams?: DashboardSearchParams
}) {
  const dashboardData = await getDashboardData()

  if (!dashboardData) {
    redirect(`/${params.locale}/login`)
  }

  const notice = await buildRedirectNotice(params.locale, searchParams)

  return <DashboardClient locale={params.locale} initialData={dashboardData} notice={notice} />
}
