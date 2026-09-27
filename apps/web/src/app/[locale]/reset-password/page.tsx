import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import ResetPasswordClient from './reset-password-client'

type Props = {
  params: { locale: string }
}

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('resetPassword.title'),
    description: t('resetPassword.description'),
  }
}

export default async function ResetPasswordPage({ params }: Props) {
  return <ResetPasswordClient params={await params} />
}
