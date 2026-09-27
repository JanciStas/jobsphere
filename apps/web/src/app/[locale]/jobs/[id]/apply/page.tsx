import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import ApplyClient from './apply-client'

type Props = {
  params: { id: string; locale: string }
}

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('applyJob.title'),
    description: t('applyJob.description'),
  }
}

export default function ApplyPage({ params }: Props) {
  return <ApplyClient params={params} />
}
