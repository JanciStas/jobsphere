import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import ForgotPasswordClient from './forgot-password-client'

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
    title: t('forgotPassword.title'),
    description: t('forgotPassword.description'),
  }
}

export default function ForgotPasswordPage({ params }: Props) {
  return <ForgotPasswordClient params={params} />
}
