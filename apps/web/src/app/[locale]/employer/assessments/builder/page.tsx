import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import AssessmentBuilderClient from './assessment-builder-client'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('assessmentBuilder.title'),
    description: t('assessmentBuilder.description'),
  }
}

export default function AssessmentBuilderPage() {
  return <AssessmentBuilderClient />
}
