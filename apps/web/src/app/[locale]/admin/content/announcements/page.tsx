import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { isCmsTableMissing } from '@/lib/cms/safe'
import { AnnouncementsList } from './_components/announcements-list'
import {
  toAdminAnnouncement,
  type AdminAnnouncement,
  type AnnouncementsLoadState,
} from './_components/admin-announcement'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminAnnouncements' })
  return { title: t('title') }
}

/** Admin list of site announcements. The admin layout already enforces global admin. */
export default async function AdminAnnouncementsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  let items: AdminAnnouncement[] = []
  let loadState: AnnouncementsLoadState = 'ok'
  try {
    const rows = await prisma.siteAnnouncement.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })
    items = rows.map(toAdminAnnouncement)
  } catch (error) {
    if (isCmsTableMissing(error)) {
      loadState = 'missing'
    } else {
      logger.error('Admin announcements page: load failed', { error })
      loadState = 'error'
    }
  }

  return (
    <AnnouncementsList
      locale={locale}
      initialItems={items}
      loadState={loadState}
      renderedAt={new Date().toISOString()}
    />
  )
}
