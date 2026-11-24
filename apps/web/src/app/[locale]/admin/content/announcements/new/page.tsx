import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { AnnouncementForm } from '../_components/announcement-form'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminAnnouncements.form' })
  return { title: t('createTitle') }
}

export default async function NewAnnouncementPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  return <AnnouncementForm locale={locale} />
}
