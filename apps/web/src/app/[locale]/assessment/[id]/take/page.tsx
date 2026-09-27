import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import TakeAssessmentClient from './take-assessment-client'

type Props = {
  params: { id: string }
}

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('takeAssessment.title'),
    description: t('takeAssessment.description'),
  }
}

export default async function TakeAssessmentPage({ params }: Props) {
  return <TakeAssessmentClient params={await params} />
}
