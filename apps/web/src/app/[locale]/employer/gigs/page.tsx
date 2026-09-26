import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import GigsClient from './gigs-client'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('employerGigs.title'),
  }
}

export default function EmployerGigsPage({ params }: { params: { locale: string } }) {
  return <GigsClient params={params} />
}
