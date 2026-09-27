import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import CreateCVClient from './create-cv-client'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('createCv.title'),
    description: t('createCv.description'),
  }
}

export default function CreateCVPage() {
  return <CreateCVClient />
}
