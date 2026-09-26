import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import CVUploadClient from './cv-upload-client'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('uploadCv.title'),
    description: t('uploadCv.description'),
  }
}

export default function CVUploadPage() {
  return <CVUploadClient />
}
