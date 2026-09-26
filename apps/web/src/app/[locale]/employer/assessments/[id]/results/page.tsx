import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { ResultsList } from '@/components/assessments/ResultsList'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('employerAssessmentResults.title'),
    description: t('employerAssessmentResults.description'),
  }
}

export default async function AssessmentResultsPage({
  params,
}: {
  params: { id: string; locale: string }
}) {
  const session = await auth()

  if (!session?.user?.id) {
    redirect(`/${params.locale}/login`)
  }

  // Get assessment with organization check
  const assessment = await prisma.assessment.findUnique({
    where: { id: params.id },
    include: {
      sections: {
        include: {
          questions: true,
        },
      },
    },
  })

  if (!assessment) {
    return (
      <div className="container mx-auto py-10">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Assessment not found</AlertDescription>
        </Alert>
      </div>
    )
  }

  // Verify user has access to this organization
  const membership = await prisma.userOrgRole.findFirst({
    where: {
      userId: session.user.id,
      orgId: assessment.orgId,
    },
  })

  if (!membership) {
    return (
      <div className="container mx-auto py-10">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You do not have permission to view results for this assessment.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  // Fetch all attempts for this assessment
  const attempts = await prisma.attempt.findMany({
    where: {
      invite: {
        assessmentId: params.id,
      },
    },
    include: {
      candidate: {
        include: {
          contacts: {
            where: { isPrimary: true },
          },
        },
      },
    },
    orderBy: { submittedAt: 'desc' },
  })

  return (
    <div className="container mx-auto py-10">
      {/* Header */}
      <div className="mb-8">
        <Link href={`/${params.locale}/employer/assessments`}>
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Assessments
          </Button>
        </Link>
        <h1 className="mb-2 text-3xl font-bold">{assessment.name}</h1>
        <p className="text-muted-foreground">
          {assessment.description || 'View and analyze assessment results'}
        </p>
        <div className="mt-4 flex gap-4 text-sm text-muted-foreground">
          <span>Duration: {assessment.durationMin} minutes</span>
          <span>•</span>
          <span>Passing Score: {assessment.passingScore}%</span>
          <span>•</span>
          <span>
            {assessment.sections.length} section{assessment.sections.length !== 1 ? 's' : ''}
          </span>
          <span>•</span>
          <span>
            {assessment.sections.reduce((acc, s) => acc + s.questions.length, 0)} question
            {assessment.sections.reduce((acc, s) => acc + s.questions.length, 0) !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Results */}
      <ResultsList
        attempts={attempts.map((attempt) => ({
          ...attempt,
          submittedAt: attempt.submittedAt ? new Date(attempt.submittedAt) : null,
        }))}
        passingScore={assessment.passingScore || 0}
      />
    </div>
  )
}
