import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import JobsClient from './jobs-client'

export const revalidate = 3600 // ISR: revalidate public job listing every 1 hour

const PAGE_SIZE = 20

type Props = {
  params: { locale: string }
  searchParams?: {
    page?: string
    search?: string
    location?: string
    workMode?: string
    jobType?: string
    seniority?: string
  }
}

export async function generateMetadata({ params: { locale } }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return {
    title: t('jobs.title'),
    description: t('jobs.description'),
    alternates: {
      canonical: `${appUrl}/${locale}/jobs`,
    },
  }
}

// Server-side job fetch — drives initial SSR HTML (crawlable + fast LCP)
async function getPublishedJobs({
  page,
  search,
  location,
  workMode,
  jobType,
  seniority,
}: {
  page: number
  search?: string
  location?: string
  workMode?: string
  jobType?: string
  seniority?: string
}) {
  try {
    const searchOr = search
      ? [
          { title: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
          { organization: { name: { contains: search, mode: 'insensitive' as const } } },
        ]
      : undefined
    const locationOr = location
      ? [
          { city: { contains: location, mode: 'insensitive' as const } },
          { region: { contains: location, mode: 'insensitive' as const } },
        ]
      : undefined

    const where = {
      status: 'PUBLISHED' as const,
      deletedAt: null,
      ...(workMode === 'REMOTE'
        ? { remote: true }
        : workMode === 'HYBRID'
          ? { hybrid: true }
          : workMode === 'ONSITE'
            ? { remote: false, hybrid: false }
            : {}),
      ...(jobType ? { employmentType: jobType } : {}),
      ...(seniority ? { seniority } : {}),
      ...((searchOr || locationOr) && {
        AND: [...(searchOr ? [{ OR: searchOr }] : []), ...(locationOr ? [{ OR: locationOr }] : [])],
      }),
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        select: {
          id: true,
          title: true,
          description: true,
          city: true,
          region: true,
          remote: true,
          hybrid: true,
          employmentType: true,
          seniority: true,
          salaryMin: true,
          salaryMax: true,
          salaryCurrency: true,
          status: true,
          publishedAt: true,
          createdAt: true,
          organization: {
            select: {
              name: true,
              logo: true,
            },
          },
        },
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.job.count({ where }),
    ])

    const transformedJobs = jobs.map((job) => ({
      ...job,
      workMode: job.remote ? 'REMOTE' : job.hybrid ? 'HYBRID' : 'ONSITE',
      type: job.employmentType,
      location: job.city ?? job.region ?? null,
      description: job.description
        ? job.description
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        : null,
      createdAt: job.createdAt.toISOString(),
      publishedAt: job.publishedAt?.toISOString() ?? null,
    }))

    return { jobs: transformedJobs, total }
  } catch (error) {
    logger.error('Error fetching jobs for SSR listing', error)
    return { jobs: [], total: 0 }
  }
}

export default async function JobsPage({ params, searchParams }: Props) {
  const page = Math.max(1, parseInt(searchParams?.page ?? '1', 10) || 1)
  const search = searchParams?.search
  const location = searchParams?.location
  const workMode = searchParams?.workMode
  const jobType = searchParams?.jobType
  const seniority = searchParams?.seniority

  const { jobs, total } = await getPublishedJobs({
    page,
    search,
    location,
    workMode,
    jobType,
    seniority,
  })
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <JobsClient
      params={await params}
      initialJobs={jobs}
      initialTotal={total}
      initialPage={page}
      totalPages={totalPages}
      pageSize={PAGE_SIZE}
      initialFilters={{ search, location, workMode, jobType, seniority }}
    />
  )
}
