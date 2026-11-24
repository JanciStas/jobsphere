import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cmsTexts } from '@/lib/cms/texts'
import { Users, Target, Zap, BarChart3, Clock, Shield, CheckCircle, ArrowRight } from 'lucide-react'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return { title: t('forEmployers.title'), description: t('forEmployers.description') }
}

export default async function ForEmployersPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'forEmployers' })
  // Admin overrides (CMS "Texty webu") for the whitelisted keys, else the built-in text.
  const tx = await cmsTexts(locale, t, 'forEmployers')
  const features = [
    {
      icon: Users,
      title: t('features.findCandidates.title'),
      description: t('features.findCandidates.description'),
    },
    {
      icon: Target,
      title: t('features.aiMatching.title'),
      description: t('features.aiMatching.description'),
    },
    {
      icon: Zap,
      title: t('features.fastRecruitment.title'),
      description: t('features.fastRecruitment.description'),
    },
    {
      icon: BarChart3,
      title: t('features.analytics.title'),
      description: t('features.analytics.description'),
    },
    {
      icon: Clock,
      title: t('features.saveTime.title'),
      description: t('features.saveTime.description'),
    },
    {
      icon: Shield,
      title: t('features.secure.title'),
      description: t('features.secure.description'),
    },
  ]

  const benefits = [
    t('benefits.list.unlimited'),
    t('benefits.list.aiEvaluation'),
    t('benefits.list.database'),
    t('benefits.list.workflow'),
    t('benefits.list.collaboration'),
    t('benefits.list.analytics'),
    t('benefits.list.integrations'),
    t('benefits.list.support'),
  ]

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-primary/10 via-white to-white px-4 py-20">
        <div className="container mx-auto max-w-6xl">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h1 className="mb-6 text-5xl font-bold leading-tight text-foreground">
                {tx('hero.title')}
              </h1>
              <p className="mb-8 text-xl leading-relaxed text-muted-foreground">
                {tx('hero.subtitle')}
              </p>
              <div className="flex flex-col gap-4 sm:flex-row">
                <Button size="lg" className="px-8 text-lg" asChild>
                  <Link href={`/${locale}/signup`}>
                    {tx('hero.cta.start')}
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
                <Button size="lg" variant="outline" className="px-8 text-lg" asChild>
                  <Link href={`/${locale}/pricing`}>{t('hero.cta.pricing')}</Link>
                </Button>
              </div>
            </div>
            <div className="hidden lg:block">
              <div className="rounded-2xl border bg-white p-8 shadow-2xl">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                      <Users className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">{t('hero.stats.candidates')}</p>
                      <p className="text-sm text-muted-foreground">{t('hero.stats.today')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                      <Target className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">{t('hero.stats.aiMatch')}</p>
                      <p className="text-sm text-muted-foreground">{t('hero.stats.position')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                      <Zap className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">{t('hero.stats.avgTime')}</p>
                      <p className="text-sm text-muted-foreground">{t('hero.stats.process')}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="px-4 py-20">
        <div className="container mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h2 className="mb-4 text-4xl font-bold">{t('whyUs.title')}</h2>
            <p className="mx-auto max-w-2xl text-xl text-muted-foreground">{t('whyUs.subtitle')}</p>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {features.map((feature, index) => (
              <Card
                key={index}
                className="border-2 transition-all hover:border-primary/50 hover:shadow-lg"
              >
                <CardContent className="pt-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                    <feature.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mb-2 text-xl font-semibold">{feature.title}</h3>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section className="bg-muted/30 px-4 py-20">
        <div className="container mx-auto max-w-6xl">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <h2 className="mb-6 text-4xl font-bold">{t('benefits.title')}</h2>
              <p className="mb-8 text-lg text-muted-foreground">{t('benefits.subtitle')}</p>
              <div className="space-y-3">
                {benefits.map((benefit, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      <CheckCircle className="h-6 w-6 text-primary" />
                    </div>
                    <p className="text-lg">{benefit}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-6">
              <Card className="border-2">
                <CardContent className="p-6">
                  <h3 className="mb-2 text-2xl font-bold">{t('plans.starter.name')}</h3>
                  <p className="mb-4 text-muted-foreground">{t('plans.starter.description')}</p>
                  <p className="mb-4 text-4xl font-bold">{t('plans.starter.price')}</p>
                  <Button className="w-full" variant="outline" asChild>
                    <Link href={`/${locale}/signup`}>{t('plans.starter.cta')}</Link>
                  </Button>
                </CardContent>
              </Card>
              <Card className="border-2 border-primary shadow-lg">
                <CardContent className="p-6">
                  <div className="mb-2 inline-block rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground">
                    {t('plans.pro.popular')}
                  </div>
                  <h3 className="mb-2 text-2xl font-bold">{t('plans.pro.name')}</h3>
                  <p className="mb-4 text-muted-foreground">{t('plans.pro.description')}</p>
                  <p className="mb-4 text-4xl font-bold">
                    {t('plans.pro.price')}
                    <span className="text-lg text-muted-foreground">{t('plans.pro.period')}</span>
                  </p>
                  <Button className="w-full" asChild>
                    <Link href={`/${locale}/signup`}>{t('plans.pro.cta')}</Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="px-4 py-20">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="mb-6 text-4xl font-bold">{tx('cta.title')}</h2>
          <p className="mx-auto mb-8 max-w-2xl text-xl text-muted-foreground">
            {tx('cta.subtitle')}
          </p>
          <div className="flex flex-col justify-center gap-4 sm:flex-row">
            <Button size="lg" className="px-8 text-lg" asChild>
              <Link href={`/${locale}/signup`}>
                {t('cta.create')}
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="px-8 text-lg" asChild>
              <Link href={`/${locale}/login`}>{t('cta.login')}</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}
