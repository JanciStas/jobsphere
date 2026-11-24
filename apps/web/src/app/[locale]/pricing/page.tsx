import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { cmsTextKeysFor, getCmsTextOverrides } from '@/lib/cms/texts'
import PricingClient from './pricing-client'

type Props = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return { title: t('pricing.title'), description: t('pricing.description') }
}

export default async function PricingPage({ params }: Props) {
  const { locale } = await params
  // Admin overrides (CMS "Texty webu") for whitelisted 'pricing.*' keys; prices stay in code.
  const textOverrides = await getCmsTextOverrides(locale, cmsTextKeysFor('pricing'))
  return <PricingClient params={{ locale }} textOverrides={textOverrides} />
}
