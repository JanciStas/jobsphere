import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import NewJobClient from './new-job-client'

type Props = {
  params: { locale: string }
}

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('newJob.title'),
    description: t('newJob.description'),
  }
}

export default async function NewJobPage({ params }: Props) {
  return <NewJobClient params={await params} />
}
