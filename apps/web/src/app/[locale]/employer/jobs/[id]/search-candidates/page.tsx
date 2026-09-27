import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import SearchCandidatesClient from './search-candidates-client'

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
    title: t('searchCandidates.title'),
    description: t('searchCandidates.description'),
  }
}

export default async function SearchCandidatesPage({ params }: Props) {
  return <SearchCandidatesClient params={await params} />
}
