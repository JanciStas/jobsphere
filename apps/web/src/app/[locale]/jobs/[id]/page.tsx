import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getFormatter, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { formatMoney } from '@/lib/formats'
import {
  MapPin,
  Euro,
  Calendar,
  Building2,
  Users,
  Globe,
  CheckCircle,
  ArrowLeft,
  Send,
} from 'lucide-react'
import { ViewTracker } from '@/components/job/view-tracker'
import { SaveJobButton } from '@/components/job/save-job-button'
import { ShareJobButton } from '@/components/job/share-job-button'
import { formatDistanceToNow } from 'date-fns'
import { sk, cs, pl, de, enUS } from 'date-fns/locale'
import { logger } from '@/lib/logger'

export const revalidate = 7200 // Revalidate job detail every 2 hours

export async function generateMetadata({
  params,
}: {
  params: { id: string; locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'pageMetadata' })
  let job = null
  try {
    job = await prisma.job.findUnique({
      where: { id: params.id, status: 'PUBLISHED' },
      select: {
        title: true,
        description: true,
        city: true,
        region: true,
        salaryMin: true,
        salaryMax: true,
        salaryCurrency: true,
        employmentType: true,
        metaTitle: true,
        metaDescription: true,
        organization: { select: { name: true } },
      },
    })
  } catch {
    return { title: t('jobNotFound') }
  }

  if (!job) {
    return { title: t('jobNotFound') }
  }

  const title = job.metaTitle || t('jobTitle', { title: job.title, company: job.organization.name })
  const location = job.city || job.region || t('jobRemote')
  const salary =
    job.salaryMin && job.salaryMax
      ? ` | ${job.salaryCurrency} ${job.salaryMin.toLocaleString()}-${job.salaryMax.toLocaleString()}`
      : ''
  const description =
    job.metaDescription ||
    `${job.title} - ${job.employmentType.replace('_', ' ')} in ${location}${salary} | ${job.organization.name}`

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  return {
    title,
    description,
    openGraph: {
      title: `${title} | JobSphere`,
      description,
      type: 'website',
      url: `/${params.locale}/jobs/${params.id}`,
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | JobSphere`,
      description,
    },
    alternates: {
      canonical: `${appUrl}/${params.locale}/jobs/${params.id}`,
      languages: {
        en: `${appUrl}/en/jobs/${params.id}`,
        de: `${appUrl}/de/jobs/${params.id}`,
        cs: `${appUrl}/cs/jobs/${params.id}`,
        sk: `${appUrl}/sk/jobs/${params.id}`,
        pl: `${appUrl}/pl/jobs/${params.id}`,
      },
    },
  }
}

// Get date locale based on current locale
function getDateLocale(locale: string) {
  switch (locale) {
    case 'sk':
      return sk
    case 'cs':
      return cs
    case 'pl':
      return pl
    case 'de':
      return de
    default:
      return enUS
  }
}

// Fetch job data
async function getJob(id: string) {
  try {
    const job = await prisma.job.findUnique({
      where: {
        id,
        status: 'PUBLISHED',
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            description: true,
            logo: true,
            website: true,
          },
        },
        _count: {
          select: {
            applications: true,
          },
        },
      },
    })

    return job
  } catch (error) {
    logger.error('Error fetching job', error)
    return null
  }
}

// Similar jobs
async function getSimilarJobs(job: any, limit: number = 3) {
  try {
    const similarJobs = await prisma.job.findMany({
      where: {
        status: 'PUBLISHED',
        id: { not: job.id },
        OR: [
          { seniority: job.seniority },
          { remote: job.remote },
          { hybrid: job.hybrid },
          { employmentType: job.employmentType },
          { orgId: job.orgId },
        ],
      },
      include: {
        organization: {
          select: {
            name: true,
            logo: true,
          },
        },
      },
      take: limit,
      orderBy: {
        createdAt: 'desc',
      },
    })

    return similarJobs
  } catch (error) {
    logger.error('Error fetching similar jobs', error)
    return []
  }
}

// Generate JSON-LD structured data for Google for Jobs
function generateJobPostingJsonLd(job: any, locale: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://jobsphere.com'

  const employmentTypeMap: Record<string, string> = {
    FULL_TIME: 'FULL_TIME',
    PART_TIME: 'PART_TIME',
    CONTRACT: 'CONTRACTOR',
    INTERNSHIP: 'INTERN',
    TEMPORARY: 'TEMPORARY',
  }

  // addressCountry: use stored job.country; fallback to 'SK' (Slovak-focused platform)
  const addressCountry: string = job.country ?? 'SK'

  // validThrough: use closedAt if set, otherwise publishedAt + 30 days, or createdAt + 30 days
  const baseDate = job.publishedAt ? new Date(job.publishedAt) : new Date(job.createdAt)
  const validThroughDate = job.closedAt
    ? new Date(job.closedAt)
    : new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000)
  const validThrough = validThroughDate.toISOString().split('T')[0]

  // datePosted: prefer publishedAt over createdAt for accuracy
  const datePosted = job.publishedAt
    ? new Date(job.publishedAt).toISOString().split('T')[0]
    : new Date(job.createdAt).toISOString().split('T')[0]

  const jsonLd: Record<string, any> = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: job.description || '',
    datePosted,
    validThrough,
    employmentType: employmentTypeMap[job.employmentType] || job.employmentType,
    hiringOrganization: {
      '@type': 'Organization',
      name: job.organization.name,
      ...(job.organization.logo && { logo: job.organization.logo }),
      ...(job.organization.website && { sameAs: job.organization.website }),
    },
    jobLocation: {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress',
        ...(job.city && { addressLocality: job.city }),
        ...(job.region && { addressRegion: job.region }),
        addressCountry,
      },
    },
    directApply: true,
    url: `${appUrl}/${locale}/jobs/${job.id}`,
  }

  if (job.remote) {
    // Google for Jobs: TELECOMMUTE flag + applicant location requirements
    jsonLd.jobLocationType = 'TELECOMMUTE'
    jsonLd.applicantLocationRequirements = {
      '@type': 'Country',
      name: addressCountry,
    }
  }

  if (job.salaryMin || job.salaryMax) {
    const unitText = job.salaryPeriod === 'MONTH' ? 'MONTH' : 'YEAR'
    jsonLd.baseSalary = {
      '@type': 'MonetaryAmount',
      currency: job.salaryCurrency || 'EUR',
      value: {
        '@type': 'QuantitativeValue',
        unitText,
        ...(job.salaryMin && job.salaryMax
          ? { minValue: job.salaryMin, maxValue: job.salaryMax }
          : job.salaryMin
            ? { value: job.salaryMin }
            : { maxValue: job.salaryMax }),
      },
    }
  }

  return jsonLd
}

export default async function JobDetailPage({
  params,
}: {
  params: { id: string; locale: string }
}) {
  const job = await getJob(params.id)
  const t = await getTranslations()
  const format = await getFormatter()
  const dateLocale = getDateLocale(params.locale)

  // Salaries render in the posting's own currency, not a hardcoded euro sign.
  const money = (amount: number, currency: string) => formatMoney(format.number, amount, currency)

  if (!job) {
    notFound()
  }

  const similarJobs = await getSimilarJobs(job)
  const jobPostingJsonLd = generateJobPostingJsonLd(job, params.locale)

  // Format work mode based on remote/hybrid boolean flags
  const getWorkModeLabel = () => {
    if (job.remote) return t('jobs.remote')
    if (job.hybrid) return t('jobs.hybrid')
    return t('jobs.onsite')
  }

  // Format job type
  const getJobTypeLabel = (type: string) => {
    switch (type) {
      case 'FULL_TIME':
        return t('jobs.fullTime')
      case 'PART_TIME':
        return t('jobs.partTime')
      case 'CONTRACT':
        return t('jobs.contract')
      default:
        return type
    }
  }

  // Parse markdown-like content for better display
  const renderDescription = (text: string | null | undefined) => {
    if (!text) return <p className="text-muted-foreground">{t('jobDetail.noDescription')}</p>

    const sections = text.split('\n\n')
    return sections.map((section, idx) => {
      // Headers
      if (section.startsWith('## ')) {
        return (
          <h3 key={idx} className="mb-3 mt-6 text-xl font-semibold">
            {section.replace('## ', '')}
          </h3>
        )
      }
      if (section.startsWith('# ')) {
        return (
          <h2 key={idx} className="mb-3 mt-6 text-2xl font-bold">
            {section.replace('# ', '')}
          </h2>
        )
      }

      // List items
      if (section.includes('\n- ') || section.startsWith('- ')) {
        const items = section.split('\n').filter((item) => item.startsWith('- '))
        return (
          <ul key={idx} className="mb-4 space-y-2">
            {items.map((item, i) => (
              <li key={i} className="flex items-start gap-2">
                <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <span>{item.replace('- ', '')}</span>
              </li>
            ))}
          </ul>
        )
      }

      // Regular paragraphs
      return (
        <p key={idx} className="mb-4 text-muted-foreground">
          {section}
        </p>
      )
    })
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* JSON-LD structured data for Google for Jobs */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jobPostingJsonLd).replace(/</g, '\\u003c'),
        }}
      />

      {/* Track job view */}
      <ViewTracker jobId={job.id} />

      <div className="container mx-auto px-4 py-8">
        {/* Back Button */}
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/${params.locale}/jobs`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('jobDetail.backToJobs')}
            </Link>
          </Button>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Main Content */}
          <div className="space-y-8 lg:col-span-2">
            {/* Job Header */}
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <CardTitle className="text-3xl">{job.title}</CardTitle>
                    <CardDescription className="text-lg">
                      <Link
                        href={`/${params.locale}/company/${job.organization.id}`}
                        className="hover:underline"
                      >
                        {job.organization.name}
                      </Link>
                    </CardDescription>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {job.seniority && <Badge variant="secondary">{job.seniority}</Badge>}
                      <Badge variant="outline">{getWorkModeLabel()}</Badge>
                      <Badge variant="outline">{getJobTypeLabel(job.employmentType)}</Badge>
                    </div>
                  </div>
                  {job.organization.logo && (
                    <img
                      src={job.organization.logo}
                      alt={job.organization.name}
                      className="h-16 w-16 rounded-lg object-cover"
                    />
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    <span>{job.city || job.region || 'Remote'}</span>
                  </div>
                  {(job.salaryMin || job.salaryMax) && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Euro className="h-4 w-4" />
                      <span>
                        {job.salaryMin && job.salaryMax
                          ? `${money(job.salaryMin, job.salaryCurrency)} - ${money(job.salaryMax, job.salaryCurrency)}`
                          : job.salaryMin
                            ? `${money(job.salaryMin, job.salaryCurrency)}+`
                            : `${t('jobDetail.upTo')} ${money(job.salaryMax ?? 0, job.salaryCurrency)}`}{' '}
                        / {t('jobs.perMonth')}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    <span>
                      {t('jobDetail.posted')}{' '}
                      {formatDistanceToNow(new Date(job.createdAt), {
                        addSuffix: true,
                        locale: dateLocale,
                      })}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Users className="h-4 w-4" />
                    <span>
                      {job._count.applications} {t('jobDetail.applications')}
                    </span>
                  </div>
                </div>

                <Separator className="my-6" />

                {/* Job media (company ad image / video) */}
                {(job.imageUrl || job.videoUrl) && (
                  <div className="space-y-4">
                    {job.imageUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={job.imageUrl}
                        alt={job.title}
                        className="w-full rounded-lg border object-cover"
                      />
                    )}
                    {job.videoUrl && (
                      <video
                        controls
                        className="w-full rounded-lg border bg-black"
                        src={job.videoUrl}
                      />
                    )}
                  </div>
                )}

                {/* Job Description */}
                <div className="space-y-4">
                  <h3 className="text-xl font-semibold">{t('jobDetail.description')}</h3>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    {renderDescription(job.description)}
                  </div>
                </div>

                {/* Requirements and Benefits are part of the description field */}
              </CardContent>
            </Card>

            {/* Application Section */}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="pt-6">
                <div className="flex flex-col items-center gap-4 sm:flex-row">
                  <div className="flex-1">
                    <h3 className="mb-1 text-lg font-semibold">{t('jobDetail.readyToApply')}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t('jobDetail.applyDescription')}
                    </p>
                  </div>
                  <div className="flex w-full gap-3 sm:w-auto">
                    <Button size="lg" className="flex-1 sm:flex-initial" asChild>
                      <Link href={`/${params.locale}/jobs/${job.id}/apply`}>
                        <Send className="mr-2 h-4 w-4" />
                        {t('jobDetail.applyNow')}
                      </Link>
                    </Button>
                    <SaveJobButton jobId={job.id} />
                    <ShareJobButton
                      jobId={job.id}
                      jobTitle={job.title}
                      companyName={job.organization.name}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Company Info */}
            <Card>
              <CardHeader>
                <CardTitle>{t('jobDetail.aboutCompany')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  {job.organization.logo ? (
                    <img
                      src={job.organization.logo}
                      alt={job.organization.name}
                      className="h-12 w-12 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                      <Building2 className="h-6 w-6" />
                    </div>
                  )}
                  <div>
                    <p className="font-semibold">{job.organization.name}</p>
                  </div>
                </div>

                {job.organization.description && (
                  <p className="text-sm text-muted-foreground">{job.organization.description}</p>
                )}

                <div className="space-y-2">
                  {job.organization.website && (
                    <div className="flex items-center gap-2 text-sm">
                      <Globe className="h-4 w-4" />
                      <a
                        href={job.organization.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {t('jobDetail.visitWebsite')}
                      </a>
                    </div>
                  )}
                </div>

                <Button variant="outline" className="w-full" asChild>
                  <Link href={`/${params.locale}/company/${job.organization.id}`}>
                    {t('jobDetail.viewAllJobs')}
                  </Link>
                </Button>
              </CardContent>
            </Card>

            {/* Similar Jobs */}
            {similarJobs.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('jobDetail.similarJobs')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {similarJobs.map((similarJob) => (
                    <Link
                      key={similarJob.id}
                      href={`/${params.locale}/jobs/${similarJob.id}`}
                      className="-mx-3 block space-y-1 rounded-lg p-3 transition-colors hover:bg-muted"
                    >
                      <p className="line-clamp-1 font-medium">{similarJob.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {similarJob.organization.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {similarJob.city || similarJob.region || 'Remote'}
                      </p>
                      {(similarJob.salaryMin || similarJob.salaryMax) && (
                        <p className="text-sm font-medium text-primary">
                          {similarJob.salaryMin && similarJob.salaryMax
                            ? `${money(similarJob.salaryMin, similarJob.salaryCurrency)} - ${money(similarJob.salaryMax, similarJob.salaryCurrency)}`
                            : similarJob.salaryMin
                              ? `${money(similarJob.salaryMin, similarJob.salaryCurrency)}+`
                              : `${t('jobDetail.upTo')} ${money(similarJob.salaryMax ?? 0, similarJob.salaryCurrency)}`}
                        </p>
                      )}
                    </Link>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Quick Stats */}
            <Card>
              <CardHeader>
                <CardTitle>{t('jobDetail.quickStats')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t('jobDetail.posted')}:</span>
                    <span className="font-medium">
                      {formatDistanceToNow(new Date(job.createdAt), {
                        addSuffix: true,
                        locale: dateLocale,
                      })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t('jobDetail.applications')}:</span>
                    <span className="font-medium">{job._count.applications}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
