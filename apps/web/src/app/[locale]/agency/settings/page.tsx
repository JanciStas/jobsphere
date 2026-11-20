import Link from 'next/link'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { requireAgency } from '../_lib/agency-context'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'agencyDashboard' })
  return { title: t('settings.title') }
}

export default async function AgencySettingsPage({ params }: { params: { locale: string } }) {
  const { orgId } = await requireAgency(params.locale)
  const t = await getTranslations({ locale: params.locale, namespace: 'agencyDashboard' })
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { name: true, website: true },
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('settings.agencyProfile')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="text-muted-foreground">{t('settings.name')}: </span>
            <span className="font-medium">{org?.name}</span>
          </p>
          {org?.website && (
            <p>
              <span className="text-muted-foreground">{t('settings.website')}: </span>
              <span className="font-medium">{org.website}</span>
            </p>
          )}
          <p className="text-muted-foreground">{t('settings.hint')}</p>
          <Button variant="outline" asChild>
            <Link href={`/${params.locale}/employer/settings`}>{t('settings.edit')}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
