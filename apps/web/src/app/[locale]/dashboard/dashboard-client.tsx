'use client'

import { useFormatter, useTranslations } from 'next-intl'
import Link from 'next/link'
import { FileText, Hourglass, Heart, UserCheck, Briefcase } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { StatCard } from '@/components/dashboard/stat-card'
import { SHORT_DATE } from '@/lib/formats'

interface DashboardData {
  user: {
    name: string
    email: string
    avatarUrl?: string | null
  }
  stats: {
    total: number
    inProcess: number
    saved: number
    pending: number
    reviewing: number
    accepted: number
    rejected: number
  }
  profileCompletion: number
  profileSteps: {
    basicInfo: boolean
    cvUploaded: boolean
    skills: boolean
    preferences: boolean
  }
  applications: Array<{
    id: string
    jobTitle: string
    company: string
    companyLogo?: string | null
    status: string
    appliedAt: string
    location: string
    jobId: string
  }>
  recommendedJobs: Array<{
    id: string
    title: string
    company: string
    companyLogo?: string | null
    location: string
    salaryMin?: number | null
    salaryMax?: number | null
    type?: string | null
    match: number
  }>
}

interface DashboardClientProps {
  locale: string
  initialData: DashboardData
  /** Server-rendered explanation for a redirect (e.g. `?error=no_organization`). */
  notice?: React.ReactNode
}

const KNOWN_STAGES = ['NEW', 'SCREENING', 'PHONE', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED']

export default function DashboardClient({ locale, initialData, notice }: DashboardClientProps) {
  const t = useTranslations('candidateDashboard')
  const format = useFormatter()
  const { user, stats, profileCompletion, applications, recommendedJobs } = initialData

  const stageLabel = (stage: string) => (KNOWN_STAGES.includes(stage) ? t(`stage.${stage}`) : stage)
  const stageVariant = (stage: string) =>
    stage === 'REJECTED' ? 'destructive' : stage === 'HIRED' ? 'default' : 'secondary'

  const formatSalary = (min?: number | null, max?: number | null) => {
    if (!min && !max) return t('salaryNegotiable')
    if (min && max) return `${min} - ${max} €`
    if (min) return `${min}+ €`
    return `${t('salaryUpTo')} ${max} €`
  }

  return (
    <div className="space-y-6">
      {notice ? <div>{notice}</div> : null}

      <div>
        <h1 className="text-2xl font-bold">{t('welcome', { name: user.name })}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard value={stats.total} label={t('kpi.sent')} icon={FileText} />
        <StatCard value={stats.inProcess} label={t('kpi.inProcess')} icon={Hourglass} />
        <StatCard value={stats.saved} label={t('kpi.saved')} icon={Heart} />
        <StatCard value={`${profileCompletion} %`} label={t('kpi.profile')} icon={UserCheck} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">{t('recentApplications')}</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/${locale}/dashboard/applications`}>{t('viewAll')}</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {applications.length === 0 ? (
              <div className="py-8 text-center">
                <Briefcase
                  className="mx-auto mb-3 h-10 w-10 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="mb-4 text-muted-foreground">{t('noApplications')}</p>
                <Button asChild>
                  <Link href={`/${locale}/jobs`}>{t('browseJobs')}</Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y">
                {applications.slice(0, 5).map((app) => (
                  <li
                    key={app.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-3"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/${locale}/dashboard/applications/${app.id}`}
                        className="font-medium hover:underline"
                      >
                        {app.jobTitle}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {app.company}
                        {app.location && ` · ${app.location}`}
                        {' · '}
                        {t('appliedOn', {
                          date: format.dateTime(new Date(app.appliedAt), SHORT_DATE),
                        })}
                      </p>
                    </div>
                    <Badge variant={stageVariant(app.status)}>{stageLabel(app.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {recommendedJobs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('recommended')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {recommendedJobs.map((job) => (
                <div key={job.id} className="space-y-1 border-b pb-3 last:border-0 last:pb-0">
                  <Link
                    href={`/${locale}/jobs/${job.id}`}
                    className="text-sm font-semibold hover:underline"
                  >
                    {job.title}
                  </Link>
                  <p className="text-xs text-muted-foreground">{job.company}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.location && `${job.location} · `}
                    {formatSalary(job.salaryMin, job.salaryMax)}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
