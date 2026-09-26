import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import PricingClient from './pricing-client'

type Props = {
  params: { locale: string }
}

export async function generateMetadata({ params: { locale } }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return { title: t('pricing.title'), description: t('pricing.description') }
}

export default async function PricingPage({ params }: Props) {
  return <PricingClient params={await params} />
}
