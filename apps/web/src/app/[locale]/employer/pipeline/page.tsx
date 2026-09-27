import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveActiveMembership } from '@/lib/api-helpers'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { PipelineBoard } from '@/components/employer/pipeline-board'
import {
  ApplicantsViewControls,
  type ApplicantsSort,
  APPLICANTS_SORTS,
} from '@/components/employer/applicants-view-controls'
import { APPLICATION_STAGES, type ApplicationStage } from '@/lib/constants/application-stages'

// Maximum cards to show per Kanban column — keeps the DOM manageable
const PER_STAGE_CAP = 50

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'employer.pipeline' })
  return {
    title: t('title'),
    description: t('metaDescription'),
  }
}

export default async function PipelinePage({
  params,
  searchParams,
}: {
  params: { locale: string }
  searchParams: { jobId?: string; stage?: string; sort?: string }
}) {
  const session = await auth()
  const t = await getTranslations({ locale: params.locale, namespace: 'employer' })
  const tPipeline = await getTranslations({
    locale: params.locale,
    namespace: 'employer.pipeline',
  })
  if (!session?.user?.id) {
    redirect(`/${params.locale}/login`)
  }

  const userOrgRole = await resolveActiveMembership(session.user.id, session.user.activeOrgId)
  if (!userOrgRole) {
    redirect(`/${params.locale}/dashboard`)
  }

  const orgId = userOrgRole.orgId
  const currentJobId = searchParams.jobId
  const currentStage = APPLICATION_STAGES.includes(searchParams.stage as ApplicationStage)
    ? (searchParams.stage as ApplicationStage)
    : undefined
  const currentSort: ApplicantsSort = APPLICANTS_SORTS.includes(searchParams.sort as ApplicantsSort)
    ? (searchParams.sort as ApplicantsSort)
    : 'date_desc'

  // When a single stage is selected, only query that stage; otherwise all stages.
  const stagesToLoad: readonly ApplicationStage[] = currentStage
    ? [currentStage]
    : APPLICATION_STAGES

  // Load capped card sets per stage + true per-stage totals + job list in
  // parallel — all scoped to orgId
  const [stageResults, stageCounts, jobs] = await Promise.all([
    // One bounded query per stage (all filtered to org + optional job)
    Promise.all(
      stagesToLoad.map((stage) =>
        prisma.application.findMany({
          where: {
            // Application.orgId directly — a `job: { orgId }` relation filter
            // cannot use @@index([orgId, stage, createdAt]).
            orgId,
            stage,
            ...(currentJobId ? { jobId: currentJobId } : {}),
          },
          select: {
            id: true,
            stage: true,
            createdAt: true,
            candidateId: true,
            job: { select: { id: true, title: true } },
            candidate: {
              select: {
                contacts: {
                  take: 1,
                  select: { fullName: true, email: true },
                },
                // Candidate photo (recruiter-imported candidates have userId=null → no avatar)
                user: { select: { avatar: true } },
              },
            },
          },
          orderBy: { createdAt: currentSort === 'date_asc' ? 'asc' : 'desc' },
          take: PER_STAGE_CAP,
        }),
      ),
    ),
    // Uncapped counts, so the board can say "50 z 63" instead of silently
    // presenting the capped 50 as the whole stage.
    prisma.application.groupBy({
      by: ['stage'],
      where: {
        orgId,
        stage: { in: [...stagesToLoad] },
        ...(currentJobId ? { jobId: currentJobId } : {}),
      },
      _count: { _all: true },
    }),
    prisma.job.findMany({
      where: { orgId },
      select: { id: true, title: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const applications = stageResults.flat()

  const stageTotals: Partial<Record<ApplicationStage, number>> = {}
  for (const row of stageCounts) {
    stageTotals[row.stage as ApplicationStage] = row._count._all
  }

  // MatchScore isn't a direct relation from Application, so batch-load by the
  // model's unique compound (jobId, candidateId) and prefer the HR override.
  const scoreMap = new Map<string, number>()
  if (applications.length > 0) {
    const matchScores = await prisma.matchScore.findMany({
      where: {
        orgId,
        OR: applications.map((a) => ({ jobId: a.job.id, candidateId: a.candidateId })),
      },
      select: { jobId: true, candidateId: true, score0to100: true, overrideScore: true },
    })
    for (const m of matchScores) {
      scoreMap.set(`${m.jobId}:${m.candidateId}`, m.overrideScore ?? m.score0to100)
    }
  }

  const cards = applications.map((a) => ({
    id: a.id,
    stage: a.stage,
    createdAt: a.createdAt.toISOString(),
    job: a.job,
    candidate: { contacts: a.candidate.contacts },
    score: scoreMap.get(`${a.job.id}:${a.candidateId}`) ?? null,
    avatar: a.candidate.user?.avatar ?? null,
  }))

  // Score sort reorders the loaded cards; date sort is already applied at DB level.
  if (currentSort === 'score_desc') {
    cards.sort((x, y) => (y.score ?? -1) - (x.score ?? -1))
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-8">
        <Button variant="ghost" asChild className="mb-6">
          <Link href={`/${params.locale}/employer`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('backToDashboard')}
          </Link>
        </Button>

        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-bold">{tPipeline('title')}</h1>
            <p className="text-muted-foreground">{tPipeline('subtitle')}</p>
          </div>
          <ApplicantsViewControls
            view="kanban"
            locale={params.locale}
            jobs={jobs}
            currentJobId={currentJobId}
            currentStage={currentStage}
            currentSort={currentSort}
          />
        </div>

        <PipelineBoard
          applications={cards}
          jobs={jobs}
          currentJobId={currentJobId}
          stageTotals={stageTotals}
        />
      </div>
    </div>
  )
}
