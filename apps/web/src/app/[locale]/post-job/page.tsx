import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import PostJobClient from './post-job-client'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('postJob.title'),
    description: t('postJob.description'),
  }
}

export default function PostJobPage() {
  return <PostJobClient />
}
