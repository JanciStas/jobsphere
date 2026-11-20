import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { VisibilityForm } from './visibility-form'

export const dynamic = 'force-dynamic'

export default async function FreelancerSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'freelancerDashboard.settings' })
  const session = await auth()
  const profile = await prisma.freelancerProfile.findUnique({
    where: { userId: session?.user?.id as string },
    select: { id: true, visible: true },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div>
      <VisibilityForm
        locale={locale}
        profileId={profile?.id ?? null}
        initialVisible={profile?.visible ?? true}
      />
    </div>
  )
}
