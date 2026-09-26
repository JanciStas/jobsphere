import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import ApiDocsClient from './api-docs-client'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('apiDocs.title'),
    description: t('apiDocs.description'),
  }
}

export default function ApiDocsPage() {
  return <ApiDocsClient />
}
