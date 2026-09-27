import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import EditJobClient from './edit-job-client'

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
    title: t('editJob.title'),
    description: t('editJob.description'),
  }
}

export default async function EditJobPage({ params }: Props) {
  return <EditJobClient params={await params} />
}
