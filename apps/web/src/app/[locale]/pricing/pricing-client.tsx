'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, Loader2 } from 'lucide-react'
import { logger } from '@/lib/logger'

export default function PricingClient({
  params,
  textOverrides = {},
}: {
  params: { locale: string }
  /** CMS overrides keyed by full message path ('pricing.title'), resolved on the server. */
  textOverrides?: Record<string, string>
}) {
  const t = useTranslations('pricing')
  const tx = (key: string) => textOverrides[`pricing.${key}`] ?? t(key)
  const locale = params.locale
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)

  async function handleSubscribe(planId: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE') {
    if (planId === 'STARTER') {
      router.push(`/${locale}/signup`)
      return
    }

    if (planId === 'ENTERPRISE') {
      window.location.href = 'mailto:sales@jobsphere.eu'
      return
    }

    try {
      setLoading(planId)

      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      })

      if (response.ok) {
        const { url } = await response.json()
        window.location.href = url
      } else {
        const error = await response.json()
        if (response.status === 401) {
          router.push(`/${locale}/signup?plan=${planId}`)
        } else {
          alert(error.error || 'Failed to start checkout')
        }
      }
    } catch (error) {
      logger.error('Checkout error', error)
      alert('Failed to start checkout')
    } finally {
      setLoading(null)
    }
  }

  const plans = [
    {
      name: t('plans.starter.name'),
      price: '0',
      period: t('plans.starter.period'),
      description: t('plans.starter.description'),
      features: [
        t('plans.starter.features.positions'),
        t('plans.starter.features.aiMatching'),
        t('plans.starter.features.emailNotifications'),
        t('plans.starter.features.visibility'),
        t('plans.starter.features.basicStats'),
      ],
      cta: t('plans.starter.cta'),
      popular: false,
    },
    {
      name: t('plans.pro.name'),
      price: '99',
      period: t('plans.pro.period'),
      description: t('plans.pro.description'),
      features: [
        t('plans.pro.features.positions'),
        t('plans.pro.features.advancedAi'),
        t('plans.pro.features.unlimitedApplications'),
        t('plans.pro.features.visibility'),
        t('plans.pro.features.advancedAnalytics'),
        t('plans.pro.features.cvParsing'),
        t('plans.pro.features.emailTemplates'),
        t('plans.pro.features.prioritySupport'),
      ],
      cta: t('plans.pro.cta'),
      popular: true,
    },
    {
      name: t('plans.enterprise.name'),
      price: t('plans.enterprise.price'),
      period: '',
      description: t('plans.enterprise.description'),
      features: [
        t('plans.enterprise.features.unlimitedPositions'),
        t('plans.enterprise.features.customAi'),
        t('plans.enterprise.features.accountManager'),
        t('plans.enterprise.features.unlimitedVisibility'),
        t('plans.enterprise.features.customIntegrations'),
        t('plans.enterprise.features.apiAccess'),
        t('plans.enterprise.features.whiteLabel'),
        t('plans.enterprise.features.sla'),
        t('plans.enterprise.features.customReporting'),
      ],
      cta: t('plans.enterprise.cta'),
      popular: false,
    },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="mb-4 text-4xl font-bold">{tx('title')}</h1>
          <p className="mx-auto max-w-2xl text-xl text-muted-foreground">{tx('subtitle')}</p>
        </div>

        {/* Pricing Cards */}
        <div className="mx-auto mb-16 grid max-w-6xl gap-8 md:grid-cols-3">
          {plans.map((plan) => (
            <Card
              key={plan.name}
              className={`relative flex flex-col ${
                plan.popular ? 'scale-105 border-primary shadow-lg' : ''
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <Badge className="bg-primary">{t('popular')}</Badge>
                </div>
              )}
              <CardHeader>
                <CardTitle className="text-2xl">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="mt-4">
                  <span className="text-4xl font-bold">
                    {plan.price === 'Custom' ? plan.price : `€${plan.price}`}
                  </span>
                  {plan.period && <span className="text-muted-foreground"> / {plan.period}</span>}
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <ul className="mb-6 flex-1 space-y-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={plan.popular ? 'default' : 'outline'}
                  onClick={() =>
                    handleSubscribe(
                      plan.name.toUpperCase() as 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE',
                    )
                  }
                  disabled={loading === plan.name.toUpperCase()}
                >
                  {loading === plan.name.toUpperCase() ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('loading')}
                    </>
                  ) : (
                    plan.cta
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Features Comparison */}
        <div className="mx-auto max-w-4xl">
          <Card>
            <CardHeader>
              <CardTitle>{t('comparison.title')}</CardTitle>
              <CardDescription>{t('comparison.subtitle')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="font-medium">{t('comparison.featureColumn')}</div>
                  <div className="text-right font-medium">{t('comparison.allPlansColumn')}</div>
                </div>
                <div className="space-y-3 border-t pt-4">
                  {[
                    t('comparison.features.multilingual'),
                    t('comparison.features.mobileApp'),
                    t('comparison.features.cvStorage'),
                    t('comparison.features.gdpr'),
                    t('comparison.features.database'),
                    t('comparison.features.support247'),
                  ].map((feature) => (
                    <div key={feature} className="grid grid-cols-2 gap-4 text-sm">
                      <div className="text-muted-foreground">{feature}</div>
                      <div className="text-right">
                        <Check className="inline h-5 w-5 text-primary" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* FAQ */}
        <div className="mx-auto mt-16 max-w-4xl">
          <h2 className="mb-8 text-center text-3xl font-bold">{t('faq.title')}</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('faq.q1.question')}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {t('faq.q1.answer')}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('faq.q2.question')}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {t('faq.q2.answer')}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('faq.q3.question')}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {t('faq.q3.answer')}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('faq.q4.question')}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {t('faq.q4.answer')}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 text-center">
          <h2 className="mb-4 text-3xl font-bold">{tx('cta.title')}</h2>
          <p className="mb-8 text-muted-foreground">{tx('cta.subtitle')}</p>
          <div className="flex justify-center gap-4">
            <Button size="lg" asChild>
              <Link href={`/${locale}/signup`}>{t('cta.startFree')}</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href={`/${locale}/login`}>{t('cta.login')}</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
