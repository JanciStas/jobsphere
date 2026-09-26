import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveActiveMembership } from '@/lib/api-helpers'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { ExportCSVButton } from '@/components/ExportCSVButton'
import { ApplicantsTable } from '@/components/employer/applicants-table'
import {
  ApplicantsViewControls,
  type ApplicantsSort,
  APPLICANTS_SORTS,
} from '@/components/employer/applicants-view-controls'
import { APPLICATION_STAGES, type ApplicationStage } from '@/lib/constants/application-stages'

const PAGE_SIZE = 20

interface ApplicantsFilters {
  jobId?: string
  stage?: ApplicationStage
  sort: ApplicantsSort
  search?: string
}

async function getApplicants(
  userId: string,
  activeOrgId: string | null | undefined,
  page: number,
  filters: ApplicantsFilters,
) {
  // Get user's organization
  const userOrgRole = await resolveActiveMembership(userId, activeOrgId)

  if (!userOrgRole) {
    return null
  }

  // Scope on Application.orgId (own column) rather than through the `job` relation:
  // a relation filter forces a join/subquery against Job and cannot use the
  // purpose-built @@index([orgId, stage, createdAt]). Same for the job filter —
  // `jobId` is a required FK, so `jobId: x` ⟺ `job: { id: x }`.
  // The search DOES need the relation filter, unlike the two above: candidate
  // names and emails live on CandidateContact, not on Application. It is opt-in
  // — no search term, no join — so the indexed path stays the common one.
  const where = {
    orgId: userOrgRole.orgId,
    ...(filters.jobId ? { jobId: filters.jobId } : {}),
    ...(filters.stage ? { stage: filters.stage } : {}),
    ...(filters.search
      ? {
          candidate: {
            contacts: {
              some: {
                OR: [
                  { fullName: { contains: filters.search, mode: 'insensitive' as const } },
                  { email: { contains: filters.search, mode: 'insensitive' as const } },
                ],
              },
            },
          },
        }
      : {}),
  }

  // Paginated query + total count — both scoped to the caller's org
  const [applications, total] = await Promise.all([
    prisma.application.findMany({
      where,
      select: {
        id: true,
        stage: true,
        createdAt: true,
        candidateId: true,
        job: {
          select: {
            id: true,
            title: true,
          },
        },
        candidate: {
          select: {
            contacts: {
              where: { isPrimary: true },
              take: 1,
              select: {
                fullName: true,
                email: true,
              },
            },
            // Candidate photo (recruiter-imported candidates have userId=null → no avatar)
            user: { select: { avatar: true } },
          },
        },
      },
      orderBy: { createdAt: filters.sort === 'date_asc' ? 'asc' : 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.application.count({ where }),
  ])

  // Batch-load match scores for the page rows (MatchScore isn't a direct relation).
  const scoreMap = new Map<string, number>()
  if (applications.length > 0) {
    const matchScores = await prisma.matchScore.findMany({
      where: {
        orgId: userOrgRole.orgId,
        OR: applications.map((a) => ({ jobId: a.job.id, candidateId: a.candidateId })),
      },
      select: { jobId: true, candidateId: true, score0to100: true, overrideScore: true },
    })
    for (const m of matchScores) {
      scoreMap.set(`${m.jobId}:${m.candidateId}`, m.overrideScore ?? m.score0to100)
    }
  }

  return { applications, total, orgId: userOrgRole.orgId, scoreMap }
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'employer.applicantsList' })
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  }
}

export default async function ApplicantsPage({
  params,
  searchParams,
}: {
  params: { locale: string }
  searchParams?: { page?: string; jobId?: string; stage?: string; sort?: string; search?: string }
}) {
  const session = await auth()
  const t = await getTranslations({ locale: params.locale, namespace: 'employer' })
  const tList = await getTranslations({
    locale: params.locale,
    namespace: 'employer.applicantsList',
  })

  if (!session?.user?.id) {
    redirect(`/${params.locale}/login`)
  }

  const page = Math.max(1, parseInt(searchParams?.page ?? '1', 10) || 1)
  const currentJobId = searchParams?.jobId
  const currentStage = APPLICATION_STAGES.includes(searchParams?.stage as ApplicationStage)
    ? (searchParams?.stage as ApplicationStage)
    : undefined
  const currentSort: ApplicantsSort = APPLICANTS_SORTS.includes(
    searchParams?.sort as ApplicantsSort,
  )
    ? (searchParams?.sort as ApplicantsSort)
    : 'date_desc'

  const currentSearch = searchParams?.search?.trim() || undefined

  const result = await getApplicants(session.user.id, session.user.activeOrgId, page, {
    jobId: currentJobId,
    stage: currentStage,
    sort: currentSort,
    search: currentSearch,
  })

  if (!result) {
    redirect(`/${params.locale}/dashboard`)
  }

  const { applications, total, scoreMap } = result
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Stats require DB-side aggregation — org-wide overview (unaffected by filters).
  const stageCounts = await prisma.application.groupBy({
    by: ['stage'],
    where: { orgId: result.orgId },
    _count: { stage: true },
  })

  const stageMap = Object.fromEntries(stageCounts.map((s) => [s.stage, s._count.stage]))

  const stats = {
    total,
    new: stageMap['NEW'] ?? 0,
    reviewing: stageMap['SCREENING'] ?? 0,
    interviewed: stageMap['INTERVIEW'] ?? 0,
  }

  // Load org jobs for the position filter dropdown.
  const jobs = await prisma.job.findMany({
    where: { orgId: result.orgId },
    select: { id: true, title: true },
    orderBy: { createdAt: 'desc' },
  })

  const tableApplications = applications.map((a) => ({
    id: a.id,
    candidateName: a.candidate.contacts?.[0]?.fullName || a.candidate.contacts?.[0]?.email || '',
    candidateEmail: a.candidate.contacts?.[0]?.email || '',
    jobTitle: a.job.title,
    stage: a.stage,
    createdAt: a.createdAt,
    avatar: a.candidate.user?.avatar ?? null,
    score: scoreMap.get(`${a.job.id}:${a.candidateId}`) ?? null,
  }))

  // Score sort reorders the page; date sort is already applied at DB level.
  if (currentSort === 'score_desc') {
    tableApplications.sort((x, y) => (y.score ?? -1) - (x.score ?? -1))
  }

  // Build a page href preserving the active filters
  function pageHref(p: number) {
    const sp = new URLSearchParams()
    if (p > 1) sp.set('page', String(p))
    if (currentJobId) sp.set('jobId', currentJobId)
    if (currentStage) sp.set('stage', currentStage)
    if (currentSort !== 'date_desc') sp.set('sort', currentSort)
    const qs = sp.toString()
    return `/${params.locale}/employer/applicants${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-8">
        {/* Back Button */}
        <Button variant="ghost" asChild className="mb-6">
          <Link href={`/${params.locale}/employer`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('backToDashboard')}
          </Link>
        </Button>

        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold">{tList('title')}</h1>
            <p className="text-muted-foreground">{tList('subtitle')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ApplicantsViewControls
              view="list"
              locale={params.locale}
              jobs={jobs}
              currentJobId={currentJobId}
              currentStage={currentStage}
              currentSort={currentSort}
              currentSearch={currentSearch}
            />
            <ExportCSVButton />
          </div>
        </div>

        {/* Stats */}
        <div className="mb-8 grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tList('statTotal')}
              </CardTitle>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tList('statNew')}
              </CardTitle>
              <div className="text-2xl font-bold text-blue-600">{stats.new}</div>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tList('statInProgress')}
              </CardTitle>
              <div className="text-2xl font-bold text-orange-600">{stats.reviewing}</div>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {tList('statInterview')}
              </CardTitle>
              <div className="text-2xl font-bold text-purple-600">{stats.interviewed}</div>
            </CardHeader>
          </Card>
        </div>

        {/* Applicants List */}
        <Card>
          <CardContent className="pt-6">
            <ApplicantsTable applications={tableApplications} locale={params.locale} />
          </CardContent>
        </Card>

        {/* Crawlable pagination */}
        {totalPages > 1 && (
          <nav
            aria-label="Applicants pagination"
            className="mt-8 flex items-center justify-center gap-2"
          >
            {page > 1 && (
              <a
                href={pageHref(page - 1)}
                rel="prev"
                className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
                {tList('prev')}
              </a>
            )}

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => {
                const near = [page - 2, page - 1, page, page + 1, page + 2]
                return p === 1 || p === totalPages || near.includes(p)
              })
              .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('ellipsis')
                acc.push(p)
                return acc
              }, [])
              .map((item, idx) =>
                item === 'ellipsis' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">
                    …
                  </span>
                ) : (
                  <a
                    key={item}
                    href={pageHref(item)}
                    aria-current={item === page ? 'page' : undefined}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm font-medium hover:bg-muted ${
                      item === page
                        ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                        : ''
                    }`}
                  >
                    {item}
                  </a>
                ),
              )}

            {page < totalPages && (
              <a
                href={pageHref(page + 1)}
                rel="next"
                className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                aria-label="Next page"
              >
                {tList('next')}
                <ChevronRight className="h-4 w-4" />
              </a>
            )}
          </nav>
        )}
      </div>
    </div>
  )
}
