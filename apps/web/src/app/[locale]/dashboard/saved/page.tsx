import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { Metadata } from 'next'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, MapPin, Euro, Building2, Heart, Briefcase } from 'lucide-react'
import { SaveJobButton } from '@/components/job/save-job-button'
import { SHORT_DATE, formatMoney } from '@/lib/formats'

async function getSavedJobs(userId: string) {
  const savedJobs = await prisma.savedJob.findMany({
    where: { userId },
    include: {
      job: {
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              logo: true,
            },
          },
          _count: {
            select: {
              applications: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return savedJobs
}

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('savedJobs.title'),
    description: t('savedJobs.description'),
  }
}

export default async function SavedJobsPage({ params }: { params: { locale: string } }) {
  const session = await auth()
  const format = await getFormatter()

  if (!session?.user?.id) {
    redirect(`/${params.locale}/login`)
  }

  const savedJobs = await getSavedJobs(session.user.id)

  // Each row carries its own currency — a PLN job must not render as euros.
  const money = (amount: number, currency: string) => formatMoney(format.number, amount, currency)

  const getWorkModeLabel = (job: (typeof savedJobs)[number]['job']) => {
    if (job.remote) return 'Remote'
    if (job.hybrid) return 'Hybrid'
    return 'On-site'
  }

  const getJobTypeLabel = (type: string) => {
    switch (type) {
      case 'FULL_TIME':
        return 'Full-time'
      case 'PART_TIME':
        return 'Part-time'
      case 'CONTRACT':
        return 'Contract'
      case 'TEMPORARY':
        return 'Temporary'
      case 'INTERNSHIP':
        return 'Internship'
      default:
        return type
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Button variant="ghost" asChild className="mb-4">
            <Link href={`/${params.locale}/dashboard`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Späť na dashboard
            </Link>
          </Button>

          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Heart className="h-6 w-6 fill-primary text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Uložené práce</h1>
              <p className="text-muted-foreground">
                {savedJobs.length}{' '}
                {savedJobs.length === 1
                  ? 'práca uložená'
                  : savedJobs.length < 5
                    ? 'práce uložené'
                    : 'prác uložených'}
              </p>
            </div>
          </div>
        </div>

        {/* Saved Jobs List */}
        {savedJobs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Heart className="mb-4 h-16 w-16 text-muted-foreground/30" />
              <h3 className="mb-2 text-xl font-semibold">Žiadne uložené práce</h3>
              <p className="mb-6 max-w-md text-center text-muted-foreground">
                Keď nájdete zaujímavú prácu, kliknite na srdce a uložte si ju sem pre neskoršie
                prehliadanie.
              </p>
              <Button asChild>
                <Link href={`/${params.locale}/jobs`}>
                  <Briefcase className="mr-2 h-4 w-4" />
                  Prehľadať práce
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {savedJobs.map(({ job, createdAt }) => (
              <Card key={job.id} className="transition-shadow hover:shadow-md">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    {/* Company Logo */}
                    {job.organization.logo ? (
                      <img
                        src={job.organization.logo}
                        alt={job.organization.name}
                        className="h-14 w-14 rounded-lg object-cover"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted">
                        <Building2 className="h-7 w-7 text-muted-foreground" />
                      </div>
                    )}

                    {/* Job Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <Link
                            href={`/${params.locale}/jobs/${job.id}`}
                            className="text-xl font-semibold hover:underline"
                          >
                            {job.title}
                          </Link>
                          <p className="text-muted-foreground">
                            <Link
                              href={`/${params.locale}/company/${job.organization.id}`}
                              className="hover:underline"
                            >
                              {job.organization.name}
                            </Link>
                          </p>
                        </div>
                        <SaveJobButton jobId={job.id} size="icon" variant="ghost" />
                      </div>

                      {/* Job Details */}
                      <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <MapPin className="h-4 w-4" />
                          <span>{job.city || 'Remote'}</span>
                        </div>
                        {(job.salaryMin || job.salaryMax) && (
                          <div className="flex items-center gap-1">
                            <Euro className="h-4 w-4" />
                            <span>
                              {job.salaryMin && job.salaryMax
                                ? `${money(job.salaryMin, job.salaryCurrency)} - ${money(job.salaryMax, job.salaryCurrency)}`
                                : job.salaryMin
                                  ? `${money(job.salaryMin, job.salaryCurrency)}+`
                                  : `Do ${money(job.salaryMax ?? 0, job.salaryCurrency)}`}
                            </span>
                          </div>
                        )}
                        <span className="text-muted-foreground/50">•</span>
                        <span>Uložené {format.dateTime(new Date(createdAt), SHORT_DATE)}</span>
                      </div>

                      {/* Badges */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {job.seniority && <Badge variant="secondary">{job.seniority}</Badge>}
                        <Badge variant="outline">{getWorkModeLabel(job)}</Badge>
                        <Badge variant="outline">{getJobTypeLabel(job.employmentType)}</Badge>
                        {job.status !== 'PUBLISHED' && (
                          <Badge variant="destructive">Neaktívna</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="mt-4 flex gap-3 border-t pt-4">
                    <Button asChild className="flex-1">
                      <Link href={`/${params.locale}/jobs/${job.id}/apply`}>Prihlásiť sa</Link>
                    </Button>
                    <Button variant="outline" asChild className="flex-1">
                      <Link href={`/${params.locale}/jobs/${job.id}`}>Zobraziť detail</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
