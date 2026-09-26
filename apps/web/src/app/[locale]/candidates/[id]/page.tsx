import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { ContactInfo } from '@/components/candidates/ContactInfo'
import { MatchScoreSection } from '@/components/candidates/MatchScoreSection'
import { ResumeSection } from '@/components/candidates/ResumeSection'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { AlertCircle, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { CandidateApplications } from '@/components/candidates/candidate-applications'
import { CandidateTags } from '@/components/candidates/candidate-tags'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('candidateProfile.title'),
    description: t('candidateProfile.description'),
  }
}

export default async function CandidateProfilePage({
  params,
}: {
  params: { id: string; locale: string }
}) {
  const session = await auth()

  if (!session?.user?.id) {
    redirect(`/${params.locale}/login`)
  }

  // Get candidate with all related data
  const candidate = await prisma.candidate.findUnique({
    where: { id: params.id },
    include: {
      contacts: {
        where: { isPrimary: true },
        take: 1,
      },
      resumes: {
        orderBy: { createdAt: 'desc' },
        include: {
          sections: {
            orderBy: { order: 'asc' },
          },
        },
        take: 1,
      },
      // Every application this person has made to this organisation. The page
      // was built around a single resume and had no idea the candidate might
      // have applied before — so a recruiter opening a profile could not see
      // that the same person was rejected for a different role last month.
      applications: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          stage: true,
          createdAt: true,
          rejectionReason: true,
          rejectedAt: true,
          job: { select: { id: true, title: true } },
        },
        take: 50,
      },
    },
  })

  if (!candidate) {
    return (
      <div className="container mx-auto py-10">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Candidate not found</AlertDescription>
        </Alert>
      </div>
    )
  }

  // Verify user has access to this candidate's organization
  const membership = await prisma.userOrgRole.findFirst({
    where: {
      userId: session.user.id,
      orgId: candidate.orgId,
    },
  })

  if (!membership) {
    return (
      <div className="container mx-auto py-10">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            You do not have permission to view this candidate profile.
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-10">
        {/* Back Button */}
        {/* Was /employer/candidates, which does not exist — no such page has
            ever been created. The applicants list is where a recruiter actually
            comes from. */}
        <Link href={`/${params.locale}/employer/applicants`}>
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Applicants
          </Button>
        </Link>

        {/* Contact Information Header */}
        <ContactInfo contact={candidate.contacts[0] || null} />

        {/* Match Scores Section */}
        <MatchScoreSection candidateId={candidate.id} locale={params.locale} />

        {/* Resume Sections */}
        <ResumeSection resume={candidate.resumes[0] || null} />

        <CandidateTags candidateId={candidate.id} />

        <CandidateApplications applications={candidate.applications} locale={params.locale} />
      </div>
    </div>
  )
}
