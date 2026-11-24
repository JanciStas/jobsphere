import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Sparkles,
  Globe2,
  FileText,
  ClipboardCheck,
  Mail,
  BarChart3,
  MapPin,
  Briefcase,
  Euro,
} from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { cmsTexts } from '@/lib/cms/texts'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return { title: t('home.title'), description: t('home.description') }
}

export default async function HomePage({ params }: Props) {
  const { locale } = await params
  // This is an async Server Component — must use the async getTranslations(),
  // NOT the useTranslations() hook (calling a hook here crashes the render).
  const t = await getTranslations({ locale })
  // Admin overrides (CMS "Texty webu") for the whitelisted keys, else the built-in text.
  const tx = await cmsTexts(locale, t)

  const latestJobs = await prisma.job.findMany({
    where: { status: 'PUBLISHED', deletedAt: null },
    take: 3,
    orderBy: { createdAt: 'desc' },
    include: { organization: { select: { name: true } } },
  })

  const companies = await prisma.organization.findMany({
    where: { logo: { not: null }, deletedAt: null },
    select: { id: true, name: true, logo: true },
    take: 12,
  })

  const features = [
    {
      icon: Sparkles,
      title: t('features.aiMatching.title'),
      description: t('features.aiMatching.description'),
    },
    {
      icon: Globe2,
      title: t('features.multiLingual.title'),
      description: t('features.multiLingual.description'),
    },
    {
      icon: FileText,
      title: t('features.smartCV.title'),
      description: t('features.smartCV.description'),
    },
    {
      icon: ClipboardCheck,
      title: t('features.assessments.title'),
      description: t('features.assessments.description'),
    },
    {
      icon: Mail,
      title: t('features.emailAutomation.title'),
      description: t('features.emailAutomation.description'),
    },
    {
      icon: BarChart3,
      title: t('features.analytics.title'),
      description: t('features.analytics.description'),
    },
  ]

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Hero Section */}
      <section className="relative flex min-h-[600px] items-center overflow-hidden py-24 sm:py-32">
        {/* Background Image */}
        <div className="absolute inset-0 z-0">
          <Image
            src="/images/jobsphere_homepage.jpg"
            alt="JobSphere Office"
            fill
            className="object-cover"
            priority
          />
          {/* Dark Overlay */}
          <div className="absolute inset-0 bg-black/60"></div>
        </div>

        <div className="container relative z-10">
          <div className="mx-auto max-w-5xl text-center">
            <h1 className="text-5xl font-bold leading-tight tracking-tight text-white sm:text-6xl lg:text-7xl">
              {tx('hero.title')}
            </h1>
            <p className="mx-auto mt-8 max-w-3xl text-xl leading-relaxed text-white/90 sm:text-2xl">
              {tx('hero.subtitle')}
            </p>
            <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="lg" className="px-8 py-6 text-lg font-medium" asChild>
                <Link href={`/${locale}/jobs`}>{tx('hero.ctaPrimary')}</Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-2 border-white bg-white/10 px-8 py-6 text-lg font-medium text-white transition-all hover:bg-white hover:text-primary"
                asChild
              >
                <Link href={`/${locale}/for-employers`}>{tx('hero.ctaSecondary')}</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Companies Section */}
      {companies.length > 0 && (
        <section className="border-b bg-white py-16 sm:py-20">
          <div className="container">
            <div className="mx-auto max-w-3xl text-center">
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Firmy, ktoré hľadajú
              </h2>
            </div>
            <div className="mx-auto mt-10 grid max-w-5xl grid-cols-2 items-center gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {companies.map((company) => (
                <Link
                  key={company.id}
                  href={`/${locale}/company/${company.id}`}
                  className="flex items-center justify-center rounded-lg border bg-white p-4 transition-shadow hover:shadow-md"
                  title={company.name}
                >
                  <Image
                    src={company.logo as string}
                    alt={company.name}
                    width={120}
                    height={60}
                    className="h-12 w-auto object-contain"
                  />
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Features Section */}
      <section className="bg-white py-24 sm:py-32">
        <div className="container">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              {t('features.title')}
            </h2>
            <p className="mt-6 text-xl leading-relaxed text-muted-foreground">
              {t('features.subtitle')}
            </p>
          </div>

          <div className="mx-auto mt-20 grid max-w-6xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <Card
                key={index}
                className="border-2 bg-white transition-all hover:border-primary/50 hover:shadow-xl"
              >
                <CardHeader>
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
                    <feature.icon className="h-7 w-7 text-primary" />
                  </div>
                  <CardTitle className="text-xl font-semibold">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base leading-relaxed">
                    {feature.description}
                  </CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Job Listings Section */}
      <section className="bg-muted/30 py-20 sm:py-32">
        <div className="container">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{t('jobs.title')}</h2>
            </div>
            <Button variant="outline" asChild>
              <Link href={`/${locale}/jobs`}>{t('jobs.viewAll')}</Link>
            </Button>
          </div>

          {latestJobs.length === 0 ? (
            <div className="mt-12 flex flex-col items-center gap-4 py-12 text-center">
              <p className="text-lg text-muted-foreground">{t('jobs.noResults')}</p>
              <Button asChild>
                <Link href={`/${locale}/post-job`}>Pridať ponuku</Link>
              </Button>
            </div>
          ) : (
            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {latestJobs.map((job) => (
                <Card key={job.id} className="transition-all hover:shadow-lg">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-xl">{job.title}</CardTitle>
                        <CardDescription className="mt-1 text-base">
                          {job.organization.name}
                        </CardDescription>
                      </div>
                      {job.remote && <Badge variant="secondary">{t('jobs.remote')}</Badge>}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {job.city && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          {job.city}
                        </div>
                      )}
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Briefcase className="h-4 w-4" />
                        {job.employmentType}
                      </div>
                      {(job.salaryMin || job.salaryMax) && (
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Euro className="h-4 w-4" />
                          {job.salaryMin && job.salaryMax
                            ? `${job.salaryMin.toLocaleString()} - ${job.salaryMax.toLocaleString()} €`
                            : job.salaryMin
                              ? `${job.salaryMin.toLocaleString()}+ €`
                              : `do ${job.salaryMax?.toLocaleString()} €`}
                        </div>
                      )}
                      <Button className="mt-4 w-full" variant="outline" asChild>
                        <Link href={`/${locale}/jobs/${job.id}`}>{t('jobs.viewDetails')}</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-br from-primary/5 to-white py-24 sm:py-32">
        <div className="container">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              {tx('page.cta.title')}
            </h2>
            <p className="mt-6 text-xl leading-relaxed text-muted-foreground">
              {tx('page.cta.subtitle')}
            </p>
            <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="lg" className="px-8 py-6 text-lg font-medium" asChild>
                <Link href={`/${locale}/signup`}>{t('nav.signup')}</Link>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-2 px-8 py-6 text-lg font-medium"
                asChild
              >
                <Link href={`/${locale}/pricing`}>{t('nav.pricing')}</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
