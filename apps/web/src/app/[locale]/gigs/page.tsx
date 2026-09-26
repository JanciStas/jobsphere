import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Euro, Clock, Building2 } from 'lucide-react'
import { GigProposalForm } from './gig-proposal-form'

export const revalidate = 60

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('gigs.title'),
    description: t('gigs.description'),
  }
}

export default async function GigsPage({ params }: { params: { locale: string } }) {
  const gigs = await prisma.gig.findMany({
    where: { status: 'OPEN' },
    select: {
      id: true,
      title: true,
      description: true,
      budget: true,
      currency: true,
      durationDays: true,
      createdAt: true,
      organization: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 60,
  })

  return (
    <div className="min-h-screen bg-muted/30 py-10">
      <div className="container mx-auto max-w-4xl px-4">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold sm:text-4xl">Zákazky pre freelancerov</h1>
          <p className="mt-2 text-muted-foreground">
            Otvorené zákazky od firiem — pošli ponuku a dohodni sa na cene a trvaní
          </p>
        </div>

        {gigs.length === 0 ? (
          <div className="rounded-lg border bg-background p-12 text-center text-muted-foreground">
            Zatiaľ tu nie sú žiadne otvorené zákazky. Si freelancer?{' '}
            <Link href={`/${params.locale}/freelancer`} className="text-primary hover:underline">
              Doplň si profil
            </Link>{' '}
            a sleduj nové zákazky.
          </div>
        ) : (
          <div className="space-y-5">
            {gigs.map((gig) => (
              <Card key={gig.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-xl">{gig.title}</CardTitle>
                      <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                        <Building2 className="h-4 w-4" />
                        {gig.organization.name}
                      </p>
                    </div>
                    <Badge>Otvorená</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {gig.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    {gig.budget != null && (
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <Euro className="h-4 w-4" />
                        {gig.budget} {gig.currency}
                      </span>
                    )}
                    {gig.durationDays != null && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {gig.durationDays} dní
                      </span>
                    )}
                  </div>
                  <GigProposalForm gigId={gig.id} currency={gig.currency} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
