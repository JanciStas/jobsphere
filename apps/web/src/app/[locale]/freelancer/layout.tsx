import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Button } from '@/components/ui/button'
import { FreelancerNav } from './freelancer-nav'

export const dynamic = 'force-dynamic'

export default async function FreelancerLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const session = await auth()
  if (!session?.user?.id) {
    redirect(`/${locale}/login/freelancer`)
  }

  const profile = await prisma.freelancerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })

  if (!profile && !session.user.isFreelancer) {
    const t = await getTranslations({ locale, namespace: 'freelancerDashboard' })
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">{t('guard.title')}</h1>
        <p className="text-muted-foreground">{t('guard.description')}</p>
        <Button asChild>
          <Link href={`/${locale}/signup?role=freelancer`}>{t('guard.cta')}</Link>
        </Button>
      </div>
    )
  }

  return <FreelancerNav locale={locale}>{children}</FreelancerNav>
}
