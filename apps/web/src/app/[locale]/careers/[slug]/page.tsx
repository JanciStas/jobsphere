import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ArrowRight, Briefcase, Building2, CheckCircle2, Globe, MapPin } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { CmsContent } from '@/components/cms/cms-content'
import { getCareerJobs, getPublicCareerPage } from '@/lib/career/queries'
import {
  careerPagePath,
  isHexColor,
  isHttpsUrl,
  readableTextColor,
  toVideoEmbedUrl,
} from '@/lib/career/media'
import { CMS_LOCALES } from '@/lib/cms/constants'

export const revalidate = 3600

type Props = { params: Promise<{ locale: string; slug: string }> }

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://jobsphere.eu'

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params
  const t = await getTranslations({ locale, namespace: 'careerPage' })
  const org = await getPublicCareerPage(slug)
  // The page streams behind loading.tsx, so notFound() keeps HTTP 200 — keep it out of indexes.
  if (!org) return { title: t('notFoundTitle'), robots: { index: false, follow: false } }

  const page = org.careerPage
  const title = t('metaTitle', { company: org.name })
  const description =
    page.subheadline || page.headline || t('metaDescription', { company: org.name })
  const path = careerPagePath(locale, org.slug)
  const image = isHttpsUrl(page.coverImage)
    ? page.coverImage
    : isHttpsUrl(org.logo)
      ? org.logo
      : null

  return {
    title,
    description,
    openGraph: {
      title: `${title} | JobSphere`,
      description,
      type: 'website',
      url: path,
      ...(image ? { images: [image] } : {}),
    },
    alternates: {
      canonical: `${APP_URL}${path}`,
      languages: Object.fromEntries(
        CMS_LOCALES.map((l) => [l, `${APP_URL}${careerPagePath(l, org.slug)}`]),
      ),
    },
  }
}

export default async function CareerPage({ params }: Props) {
  const { locale, slug } = await params
  const org = await getPublicCareerPage(slug)
  if (!org) notFound()

  const t = await getTranslations({ locale, namespace: 'careerPage' })
  const jobs = await getCareerJobs(org.id)
  const page = org.careerPage

  // Only validated values reach the markup: a hex color in an inline style, https images,
  // and an iframe src that is always one we built ourselves from a YouTube/Vimeo id.
  const brandColor = isHexColor(page.brandColor) ? page.brandColor : null
  const coverImage = isHttpsUrl(page.coverImage) ? page.coverImage : null
  const logo = isHttpsUrl(org.logo) ? org.logo : null
  const website = isHttpsUrl(org.website) ? org.website : null
  const embedUrl = toVideoEmbedUrl(page.videoUrl)
  const headline = page.headline || org.name
  const initial = org.name.trim().charAt(0).toUpperCase() || '?'

  const heroStyle = coverImage
    ? { backgroundColor: brandColor ?? '#0f172a', color: '#ffffff' }
    : brandColor
      ? { backgroundColor: brandColor, color: readableTextColor(brandColor) }
      : undefined

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: org.name,
    url: `${APP_URL}${careerPagePath(locale, org.slug)}`,
    ...(logo ? { logo } : {}),
    ...(website ? { sameAs: [website] } : {}),
    ...(page.subheadline || page.headline
      ? { description: page.subheadline || page.headline }
      : {}),
  }

  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      <section
        className={`relative overflow-hidden ${heroStyle ? '' : 'bg-primary text-primary-foreground'}`}
        style={heroStyle}
      >
        {coverImage && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary https host */}
            <img
              src={coverImage}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              fetchPriority="high"
            />
            <div className="absolute inset-0 bg-black/55" aria-hidden="true" />
          </>
        )}
        <div className="container relative mx-auto px-4 py-16 md:py-24">
          <div className="flex flex-col items-start gap-6 md:flex-row md:items-center">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- arbitrary https host
              <img
                src={logo}
                alt={t('logoAlt', { company: org.name })}
                width={96}
                height={96}
                className="h-24 w-24 rounded-xl bg-white object-contain p-2 shadow"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-xl bg-white/90 text-3xl font-bold text-slate-900 shadow">
                {initial}
              </div>
            )}
            <div className="max-w-3xl space-y-3">
              <p className="text-sm font-medium uppercase tracking-wide opacity-80">
                {t('eyebrow', { company: org.name })}
              </p>
              <h1 className="text-3xl font-bold leading-tight md:text-5xl">{headline}</h1>
              {page.subheadline && <p className="text-lg opacity-90">{page.subheadline}</p>}
              <div className="flex flex-wrap gap-3 pt-2">
                {jobs.length > 0 && (
                  <Button asChild size="lg" variant="secondary">
                    <a href="#open-positions">
                      {t('viewPositions', { count: jobs.length })}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                )}
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-current bg-transparent text-current hover:bg-white/10 hover:text-current"
                >
                  <Link href={`/${locale}/company/${org.id}`}>
                    <Building2 className="mr-2 h-4 w-4" />
                    {t('companyProfile')}
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="container mx-auto grid gap-10 px-4 py-12 lg:grid-cols-3">
        <div className="space-y-10 lg:col-span-2">
          {page.about && (
            <section aria-labelledby="about-heading">
              <h2 id="about-heading" className="mb-4 text-2xl font-bold">
                {t('aboutHeading', { company: org.name })}
              </h2>
              <CmsContent markdown={page.about} />
            </section>
          )}

          {embedUrl && (
            <section aria-labelledby="video-heading">
              <h2 id="video-heading" className="mb-4 text-2xl font-bold">
                {t('videoHeading')}
              </h2>
              <div className="aspect-video overflow-hidden rounded-xl border bg-black">
                <iframe
                  src={embedUrl}
                  title={t('videoTitle', { company: org.name })}
                  loading="lazy"
                  allow="encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  sandbox="allow-scripts allow-same-origin allow-presentation"
                  className="h-full w-full"
                />
              </div>
            </section>
          )}

          <section id="open-positions" aria-labelledby="jobs-heading" className="scroll-mt-24">
            <div className="mb-4 flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-primary" />
              <h2 id="jobs-heading" className="text-2xl font-bold">
                {t('openPositions')}
              </h2>
              <Badge variant="secondary">{jobs.length}</Badge>
            </div>
            {jobs.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  {t('noPositions')}
                </CardContent>
              </Card>
            ) : (
              <ul className="space-y-3">
                {jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={`/${locale}/jobs/${job.id}`}
                      className="group flex items-center justify-between gap-4 rounded-lg border bg-card p-4 transition-colors hover:border-primary"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold group-hover:text-primary">
                          {job.title}
                        </p>
                        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-3.5 w-3.5" />
                          {job.city || job.region || t('remote')}
                        </p>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          {page.benefits.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">{t('benefitsHeading')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {page.benefits.map((benefit, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <CheckCircle2
                        className="mt-0.5 h-5 w-5 shrink-0"
                        style={brandColor ? { color: brandColor } : undefined}
                        aria-hidden="true"
                      />
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">{org.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                {org.industry && <Badge variant="secondary">{org.industry}</Badge>}
                {org.size && <Badge variant="outline">{t('employees', { size: org.size })}</Badge>}
              </div>
              {website && (
                <a
                  href={website}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-2 text-primary hover:underline"
                >
                  <Globe className="h-4 w-4" />
                  {t('website')}
                </a>
              )}
              <div>
                <Link
                  href={`/${locale}/company/${org.id}`}
                  className="inline-flex items-center gap-2 text-primary hover:underline"
                >
                  <Building2 className="h-4 w-4" />
                  {t('companyProfile')}
                </Link>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}
