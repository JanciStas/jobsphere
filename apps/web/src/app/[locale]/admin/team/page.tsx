import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { TeamClient, type TeamAdmin } from './team-client'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'adminCore.team' })
  return { title: t('title') }
}

export default async function AdminTeamPage({ params }: { params: { locale: string } }) {
  const session = await auth()
  if (!session?.user?.id || !session.user.isGlobalAdmin) {
    redirect(`/${params.locale}/login/admin?error=forbidden`)
  }

  let admins: TeamAdmin[] = []
  let failed = false
  try {
    const rows = await prisma.user.findMany({
      where: { isGlobalAdmin: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, lastLoginAt: true, createdAt: true },
    })
    admins = rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    }))
  } catch (error) {
    logger.error('Admin team page: load failed', error)
    failed = true
  }

  return <TeamClient initialAdmins={admins} currentUserId={session.user.id} loadFailed={failed} />
}
