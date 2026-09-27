import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import SequencesClient from './sequences-client'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('sequences.title'),
    description: t('sequences.description'),
  }
}

export default function SequencesPage() {
  return <SequencesClient />
}
