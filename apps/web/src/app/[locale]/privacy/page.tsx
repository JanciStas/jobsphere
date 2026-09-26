import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('privacy.title'),
    description: t('privacy.description'),
  }
}

export default async function PrivacyPage() {
  const t = await getTranslations('legal')
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">{t('privacy.title')}</h1>
      <div className="prose prose-slate max-w-none space-y-4 text-muted-foreground">
        <p>{t('privacy.intro')}</p>
        <h2 className="text-xl font-semibold text-foreground">
          {t('privacy.dataCollected.heading')}
        </h2>
        <p>{t('privacy.dataCollected.body')}</p>
        <h2 className="text-xl font-semibold text-foreground">{t('privacy.dataUse.heading')}</h2>
        <p>{t('privacy.dataUse.body')}</p>
        <h2 className="text-xl font-semibold text-foreground">{t('privacy.rights.heading')}</h2>
        <p>{t('privacy.rights.body')}</p>
        <h2 className="text-xl font-semibold text-foreground">{t('privacy.contact.heading')}</h2>
        <p>{t('privacy.contact.body')}</p>
        <p className="text-sm">{t('lastUpdated', { date: '2026-05-15' })}</p>
      </div>
    </main>
  )
}
