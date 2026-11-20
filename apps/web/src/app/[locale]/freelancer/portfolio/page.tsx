import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listPortfolioItems } from '@/lib/portfolio-safe'
import { PortfolioManager } from './portfolio-manager'

export const dynamic = 'force-dynamic'

export default async function FreelancerPortfolioPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'freelancerDashboard.portfolio' })
  const session = await auth()
  const profile = await prisma.freelancerProfile.findUnique({
    where: { userId: session?.user?.id as string },
    select: { id: true },
  })
  const items = profile ? await listPortfolioItems(profile.id) : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      <PortfolioManager initialItems={items} hasProfile={!!profile} />
    </div>
  )
}
