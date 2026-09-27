import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('gdpr.title'),
    description: t('gdpr.description'),
  }
}

export default async function GdprPage() {
  const t = await getTranslations('legal')
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">{t('gdpr.title')}</h1>
      <div className="prose prose-slate max-w-none space-y-4 text-muted-foreground">
        <p>{t('gdpr.intro')}</p>
        <h2 className="text-xl font-semibold text-foreground">{t('gdpr.controller.heading')}</h2>
        <p>{t('gdpr.controller.body')}</p>
        <h2 className="text-xl font-semibold text-foreground">{t('gdpr.rights.heading')}</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>{t('gdpr.rights.access')}</li>
          <li>{t('gdpr.rights.rectify')}</li>
          <li>{t('gdpr.rights.erase')}</li>
          <li>{t('gdpr.rights.portability')}</li>
          <li>{t('gdpr.rights.object')}</li>
        </ul>
        <h2 className="text-xl font-semibold text-foreground">{t('gdpr.exercise.heading')}</h2>
        <p>{t('gdpr.exercise.body')}</p>
        <p className="text-sm">{t('lastUpdated', { date: '2026-05-15' })}</p>
      </div>
    </main>
  )
}
