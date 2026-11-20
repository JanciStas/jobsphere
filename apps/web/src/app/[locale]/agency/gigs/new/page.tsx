import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { requireAgency } from '../../_lib/agency-context'
import { NewGigForm } from './new-gig-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'agencyDashboard' })
  return { title: t('newGig.title') }
}

export default async function NewGigPage({ params }: { params: { locale: string } }) {
  await requireAgency(params.locale)
  const t = await getTranslations({ locale: params.locale, namespace: 'agencyDashboard' })
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('newGig.title')}</h1>
        <p className="text-muted-foreground">{t('newGig.subtitle')}</p>
      </div>
      <NewGigForm locale={params.locale} />
    </div>
  )
}
