import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import AuthErrorClient from './auth-error-client'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('authError.title'),
    description: t('authError.description'),
  }
}

export default function AuthErrorPage() {
  return <AuthErrorClient />
}
