import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { isCmsTableMissing } from '@/lib/cms/safe'
import { AnnouncementForm } from '../_components/announcement-form'
import { toAdminAnnouncement } from '../_components/admin-announcement'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminAnnouncements.form' })
  return { title: t('editTitle') }
}

export default async function EditAnnouncementPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const t = await getTranslations({ locale, namespace: 'adminAnnouncements' })

  let row: Awaited<ReturnType<typeof prisma.siteAnnouncement.findUnique>> = null
  try {
    row = await prisma.siteAnnouncement.findUnique({ where: { id } })
  } catch (error) {
    const missing = isCmsTableMissing(error)
    if (!missing) logger.error('Admin announcement edit page: load failed', { error })
    return (
      <p role="alert" className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
        {missing ? t('errors.notMigrated') : t('errors.loadFailed')}
      </p>
    )
  }
  if (!row) notFound()

  return <AnnouncementForm locale={locale} initial={toAdminAnnouncement(row)} />
}
