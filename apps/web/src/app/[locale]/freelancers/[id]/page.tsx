import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ArrowLeft, Euro, ExternalLink, MapPin } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { listPortfolioItems } from '@/lib/portfolio-safe'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export const revalidate = 300

const AVAILABILITY_KEYS = ['AVAILABLE', 'LIMITED', 'UNAVAILABLE'] as const

/** Public-safe projection only: never select the user's e-mail or other PII. */
async function loadProfile(id: string) {
  return prisma.freelancerProfile.findFirst({
    where: { id, visible: true, user: { deletedAt: null } },
    select: {
      id: true,
      title: true,
      bio: true,
      services: true,
      skills: true,
      hourlyRate: true,
      currency: true,
      availability: true,
      location: true,
      portfolioUrl: true,
      user: { select: { name: true } },
    },
  })
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}): Promise<Metadata> {
  const { locale, id } = await params
  const t = await getTranslations({ locale, namespace: 'freelancerDashboard.public' })
  const profile = await loadProfile(id)
  if (!profile) {
    return { title: t('notFoundTitle'), robots: { index: false, follow: false } }
  }
  const name = profile.user.name || t('anonymous')
  return {
    title: profile.title ? `${name} – ${profile.title}` : name,
    description: (profile.bio ?? t('metaFallback', { name })).slice(0, 160),
  }
}

export default async function FreelancerPublicPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const t = await getTranslations({ locale, namespace: 'freelancerDashboard.public' })
  const ta = await getTranslations({ locale, namespace: 'freelancerDashboard.availability' })
  const profile = await loadProfile(id)
  if (!profile) notFound()

  const portfolio = await listPortfolioItems(profile.id)
  const name = profile.user.name || t('anonymous')
  const avail = (AVAILABILITY_KEYS as readonly string[]).includes(profile.availability)
    ? (profile.availability as (typeof AVAILABILITY_KEYS)[number])
    : null

  return (
    <div className="min-h-screen bg-muted/30 pb-16">
      <section className="border-b bg-background">
        <div className="container mx-auto max-w-5xl px-4 py-10">
          <Link
            href={`/${locale}/freelancers`}
            className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('back')}
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold sm:text-4xl">{name}</h1>
              {profile.title && (
                <p className="mt-1 text-lg text-muted-foreground">{profile.title}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                {profile.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                    {profile.location}
                  </span>
                )}
                {profile.hourlyRate != null && (
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    <Euro className="h-4 w-4" aria-hidden="true" />
                    {t('perHour', { rate: profile.hourlyRate, currency: profile.currency })}
                  </span>
                )}
                {avail && (
                  <Badge variant={avail === 'AVAILABLE' ? 'default' : 'secondary'}>
                    {ta(avail)}
                  </Badge>
                )}
              </div>
            </div>
            <Button asChild>
              <Link href={`/${locale}/contact?freelancer=${encodeURIComponent(profile.id)}`}>
                {t('contact')}
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <div className="container mx-auto mt-8 max-w-5xl space-y-8 px-4">
        {profile.bio && (
          <section className="rounded-lg border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">{t('about')}</h2>
            <p className="whitespace-pre-line text-muted-foreground">{profile.bio}</p>
          </section>
        )}

        {(profile.services.length > 0 || profile.skills.length > 0) && (
          <div className="grid gap-6 md:grid-cols-2">
            {profile.services.length > 0 && (
              <section className="rounded-lg border bg-card p-6">
                <h2 className="mb-3 text-lg font-semibold">{t('services')}</h2>
                <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                  {profile.services.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </section>
            )}
            {profile.skills.length > 0 && (
              <section className="rounded-lg border bg-card p-6">
                <h2 className="mb-3 text-lg font-semibold">{t('skills')}</h2>
                <div className="flex flex-wrap gap-1.5">
                  {profile.skills.map((s, i) => (
                    <span
                      key={i}
                      className="rounded-full bg-primary/10 px-2.5 py-0.5 text-sm text-primary"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        <section>
          <h2 className="mb-4 text-lg font-semibold">{t('portfolio')}</h2>
          {portfolio.length === 0 ? (
            <p className="rounded-lg border bg-card p-6 text-muted-foreground">
              {t('noPortfolio')}
            </p>
          ) : (
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {portfolio.map((it) => (
                <li key={it.id} className="flex flex-col overflow-hidden rounded-lg border bg-card">
                  {it.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={it.imageUrl}
                      alt={it.title}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="h-44 w-full object-cover"
                    />
                  )}
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <h3 className="font-medium">{it.title}</h3>
                    {it.description && (
                      <p className="line-clamp-4 text-sm text-muted-foreground">{it.description}</p>
                    )}
                    {it.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {it.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {it.url && (
                      <a
                        href={it.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow ugc"
                        className="mt-auto inline-flex items-center gap-1 pt-2 text-sm text-primary hover:underline"
                      >
                        {t('openProject')}{' '}
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {profile.portfolioUrl && (
            <Button variant="outline" asChild className="mt-4">
              <a href={profile.portfolioUrl} target="_blank" rel="noopener noreferrer nofollow ugc">
                {t('externalPortfolio')}{' '}
                <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
          )}
        </section>
      </div>
    </div>
  )
}
