import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import ApplicationDetailClient from './application-detail-client'

type Props = {
  params: { locale: string; id: string }
}

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('applicationDetail.title'),
    description: t('applicationDetail.description'),
  }
}

export default function ApplicationDetailPage({ params }: Props) {
  return <ApplicationDetailClient params={params} />
}
