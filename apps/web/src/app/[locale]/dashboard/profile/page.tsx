import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import ProfileClient from './profile-client'

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
    title: t('profile.title'),
    description: t('profile.description'),
  }
}

export default async function ProfilePage({ params }: Props) {
  return <ProfileClient params={await params} />
}
