import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import CvsClient from './cvs-client'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('myCvs.title'),
  }
}

export default function MyCvsPage() {
  return <CvsClient />
}
