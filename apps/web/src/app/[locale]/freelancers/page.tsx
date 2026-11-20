import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MapPin, Euro, Briefcase } from 'lucide-react'

export const revalidate = 300

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('freelancers.title'),
    description: t('freelancers.description'),
  }
}

const AVAILABILITY_KEYS = ['AVAILABLE', 'LIMITED', 'UNAVAILABLE'] as const

export default async function FreelancersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'freelancerDashboard.list' })
  const ta = await getTranslations({ locale, namespace: 'freelancerDashboard.availability' })

  const freelancers = await prisma.freelancerProfile.findMany({
    where: { visible: true },
    select: {
      id: true,
      title: true,
      bio: true,
      services: true,
      hourlyRate: true,
      currency: true,
      availability: true,
      location: true,
      user: { select: { name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 60,
  })

  return (
    <div className="min-h-screen bg-muted/30 py-10">
      <div className="container mx-auto max-w-5xl px-4">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold sm:text-4xl">{t('title')}</h1>
          <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>
        </div>

        {freelancers.length === 0 ? (
          <div className="rounded-lg border bg-background p-12 text-center text-muted-foreground">
            {t('empty')}{' '}
            <Link
              href={`/${locale}/signup?role=freelancer`}
              className="text-primary hover:underline"
            >
              {t('signup')}
            </Link>
            .
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2">
            {freelancers.map((f) => {
              const avail = (AVAILABILITY_KEYS as readonly string[]).includes(f.availability)
                ? (f.availability as (typeof AVAILABILITY_KEYS)[number])
                : null
              return (
                <Card key={f.id} className="flex flex-col">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-xl">{f.user.name || t('anonymous')}</CardTitle>
                        {f.title && (
                          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                            <Briefcase className="h-4 w-4" aria-hidden="true" />
                            {f.title}
                          </p>
                        )}
                      </div>
                      {avail && (
                        <Badge variant={avail === 'AVAILABLE' ? 'default' : 'secondary'}>
                          {ta(avail)}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-3">
                    {f.bio && <p className="line-clamp-3 text-sm text-muted-foreground">{f.bio}</p>}

                    {f.services.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {f.services.slice(0, 6).map((s, i) => (
                          <span
                            key={i}
                            className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mt-auto flex flex-wrap items-center gap-4 pt-2 text-sm text-muted-foreground">
                      {f.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-4 w-4" aria-hidden="true" />
                          {f.location}
                        </span>
                      )}
                      {f.hourlyRate != null && (
                        <span className="flex items-center gap-1 font-medium text-foreground">
                          <Euro className="h-4 w-4" aria-hidden="true" />
                          {t('perHour', { rate: f.hourlyRate, currency: f.currency })}
                        </span>
                      )}
                    </div>

                    <Button variant="outline" size="sm" asChild className="mt-2 w-fit">
                      <Link href={`/${locale}/freelancers/${f.id}`}>{t('viewProfile')}</Link>
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
