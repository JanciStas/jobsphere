import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import CVEditClient from './cv-edit-client'

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
    title: t('editCv.title'),
    description: t('editCv.description'),
  }
}

export default async function CVEditPage({ params }: Props) {
  return <CVEditClient params={await params} />
}
