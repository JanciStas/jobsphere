import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { isPublicPortal } from '@/lib/portal'
import SignupClient from './signup-client'

type Props = {
  params: Promise<{ locale: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return { title: t('signup.title'), description: t('signup.description') }
}

export default async function SignupPage({ params, searchParams }: Props) {
  const sp = (await searchParams) ?? {}
  const raw = sp.role
  const role = Array.isArray(raw) ? raw[0] : raw
  return (
    <SignupClient params={await params} initialRole={isPublicPortal(role) ? role : 'candidate'} />
  )
}
