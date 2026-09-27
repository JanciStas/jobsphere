import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import SignupClient from './signup-client'

type Props = {
  params: { locale: string }
}

export async function generateMetadata({ params: { locale } }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return { title: t('signup.title'), description: t('signup.description') }
}

export default async function SignupPage({ params }: Props) {
  return <SignupClient params={await params} />
}
