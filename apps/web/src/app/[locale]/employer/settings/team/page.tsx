import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import TeamManagementClient from './team-client'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('teamManagement.title'),
    description: t('teamManagement.description'),
  }
}

export default function TeamManagementPage() {
  return <TeamManagementClient />
}
