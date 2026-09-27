import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import SettingsClient from './settings-client'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('companySettings.title'),
    description: t('companySettings.description'),
  }
}

export default function SettingsPage() {
  return <SettingsClient />
}
