import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { ArrowLeft, Building2, Clock, Euro } from 'lucide-react'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GigProposalForm } from '../gig-proposal-form'

export const dynamic = 'force-dynamic'

async function getOpenGig(id: string) {
  return prisma.gig.findFirst({
    where: { id, status: 'OPEN' },
    select: {
      id: true,
      title: true,
      description: true,
      budget: true,
      currency: true,
      durationDays: true,
      organization: { select: { name: true } },
    },
  })
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string; id: string }
}): Promise<Metadata> {
  const gig = await getOpenGig(params.id)
  return { title: gig?.title ?? 'Gig' }
}

export default async function GigDetailPage({
  params,
}: {
  params: { locale: string; id: string }
}) {
  const gig = await getOpenGig(params.id)
  if (!gig) notFound()

  const t = await getTranslations({ locale: params.locale, namespace: 'agencyDashboard' })
  const session = await auth()
  const freelancer = session?.user?.id
    ? await prisma.freelancerProfile.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      })
    : null

  return (
    <div className="min-h-screen bg-muted/30 py-10">
      <div className="container mx-auto max-w-3xl space-y-6 px-4">
        <Link
          href={`/${params.locale}/gigs`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('public.back')}
        </Link>

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="text-2xl">{gig.title}</CardTitle>
                <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                  {gig.organization.name}
                </p>
              </div>
              <Badge>{t('status.OPEN')}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="whitespace-pre-wrap text-sm">{gig.description}</p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              {gig.budget != null && (
                <span className="flex items-center gap-1 font-medium text-foreground">
                  <Euro className="h-4 w-4" aria-hidden="true" />
                  {gig.budget} {gig.currency}
                </span>
              )}
              {gig.durationDays != null && (
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  {t('common.days', { count: gig.durationDays })}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-6">
            {freelancer ? (
              <GigProposalForm gigId={gig.id} currency={gig.currency} />
            ) : session?.user?.id ? (
              <>
                <p className="text-sm text-muted-foreground">{t('public.notFreelancer')}</p>
                <Button asChild>
                  <Link href={`/${params.locale}/freelancer`}>{t('public.becomeFreelancer')}</Link>
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">{t('public.loginPrompt')}</p>
                <Button asChild>
                  <Link href={`/${params.locale}/login/freelancer`}>{t('public.loginButton')}</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
