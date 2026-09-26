import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import AssessmentResultsClient from './assessment-results-client'

type Props = {
  params: { id: string; attemptId: string }
}

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('assessmentAttemptResults.title'),
    description: t('assessmentAttemptResults.description'),
  }
}

export default function AssessmentResultsPage({ params }: Props) {
  return <AssessmentResultsClient params={params} />
}
