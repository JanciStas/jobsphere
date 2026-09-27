import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { prisma } from '@/lib/prisma'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Building2, Globe, MapPin, Briefcase, Euro, Users } from 'lucide-react'
import { logger } from '@/lib/logger'

export const revalidate = 3600 // Revalidate company profile every hour

// Only PUBLIC organization fields are ever selected/exposed here — no settings,
// members, PII or internal columns leak onto the public profile.
const PUBLIC_ORG_SELECT = {
  id: true,
  name: true,
  logo: true,
  videoUrl: true,
  description: true,
  industry: true,
  size: true,
  website: true,
} as const

async function getCompany(id: string) {
  try {
    return await prisma.organization.findUnique({
      where: { id, deletedAt: null },
      select: PUBLIC_ORG_SELECT,
    })
  } catch (error) {
    logger.error('Error fetching company profile', error)
    return null
  }
}

async function getPublishedJobs(orgId: string) {
  try {
    return await prisma.job.findMany({
      where: { orgId, status: 'PUBLISHED', deletedAt: null },
      select: {
        id: true,
        title: true,
        city: true,
        region: true,
        employmentType: true,
        seniority: true,
        salaryMin: true,
        salaryMax: true,
        salaryCurrency: true,
        publishedAt: true,
      },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    })
  } catch (error) {
    logger.error('Error fetching company jobs', error)
    return []
  }
}

export async function generateMetadata({
  params,
}: {
  params: { id: string; locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'pageMetadata' })
  const company = await getCompany(params.id)
  if (!company) return { title: t('companyNotFound') }

  const description =
    company.description?.slice(0, 160) ||
    `${company.name}${company.industry ? ` — ${company.industry}` : ''} | JobSphere`

  return {
    title: company.name,
    description,
    openGraph: {
      title: `${company.name} | JobSphere`,
      description,
      type: 'website',
      url: `/${params.locale}/company/${params.id}`,
      ...(company.logo ? { images: [company.logo] } : {}),
    },
  }
}

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: 'Plný úväzok',
  PART_TIME: 'Čiastočný úväzok',
  CONTRACT: 'Kontrakt',
  FREELANCE: 'Freelance',
  INTERNSHIP: 'Stáž',
  TEMPORARY: 'Dočasný',
}

function formatSalary(min: number | null, max: number | null, currency: string) {
  const c = currency || 'EUR'
  if (min && max) return `${min.toLocaleString()} - ${max.toLocaleString()} ${c}`
  if (min) return `${min.toLocaleString()}+ ${c}`
  if (max) return `do ${max.toLocaleString()} ${c}`
  return null
}

export default async function CompanyProfilePage({
  params,
}: {
  params: { id: string; locale: string }
}) {
  const company = await getCompany(params.id)

  if (!company) {
    notFound()
  }

  const jobs = await getPublishedJobs(company.id)
  const initial = company.name?.trim().charAt(0).toUpperCase() || '?'

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-12">
        {/* Company Header */}
        <Card className="mb-8">
          <CardHeader>
            <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
              {company.logo ? (
                <Image
                  src={company.logo}
                  alt={company.name}
                  width={96}
                  height={96}
                  className="h-24 w-24 rounded-xl object-cover"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-primary/10 text-3xl font-bold text-primary">
                  {initial}
                </div>
              )}
              <div className="space-y-2">
                <CardTitle className="text-3xl">{company.name}</CardTitle>
                <div className="flex flex-wrap gap-2">
                  {company.industry && <Badge variant="secondary">{company.industry}</Badge>}
                  {company.size && (
                    <Badge variant="outline" className="gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {company.size}
                    </Badge>
                  )}
                </div>
                {company.website && (
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Globe className="h-4 w-4" />
                    {company.website}
                  </a>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {company.videoUrl && (
              <video
                controls
                className="w-full rounded-lg border bg-black"
                src={company.videoUrl}
              />
            )}
            {company.description && (
              <div className="whitespace-pre-line leading-relaxed text-muted-foreground">
                {company.description}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Published Jobs */}
        <div className="mb-6 flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-primary" />
          <h2 className="text-2xl font-bold">Otvorené pozície</h2>
          <Badge variant="secondary" className="ml-1">
            {jobs.length}
          </Badge>
        </div>

        <Separator className="mb-8" />

        {jobs.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground" />
            <p className="text-lg text-muted-foreground">
              Táto firma momentálne nemá zverejnené žiadne pozície.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => {
              const salary = formatSalary(job.salaryMin, job.salaryMax, job.salaryCurrency)
              return (
                <Link key={job.id} href={`/${params.locale}/jobs/${job.id}`} className="group">
                  <Card className="flex h-full flex-col transition-shadow group-hover:shadow-lg">
                    <CardHeader>
                      <CardTitle className="line-clamp-2 text-lg">{job.title}</CardTitle>
                      {job.seniority && (
                        <Badge variant="secondary" className="w-fit">
                          {job.seniority}
                        </Badge>
                      )}
                    </CardHeader>
                    <CardContent className="flex-1 space-y-3 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        {job.city || job.region || 'Remote'}
                      </div>
                      <div className="flex items-center gap-2">
                        <Briefcase className="h-4 w-4" />
                        {EMPLOYMENT_TYPE_LABELS[job.employmentType] || job.employmentType}
                      </div>
                      {salary && (
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          <Euro className="h-4 w-4" />
                          {salary}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
