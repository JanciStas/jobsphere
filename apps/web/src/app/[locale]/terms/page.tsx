import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('terms.title'),
    description: t('terms.description'),
  }
}

export default async function TermsPage() {
  const t = await getTranslations('legal')
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">{t('terms.title')}</h1>
      <div className="prose prose-slate max-w-none space-y-4 text-muted-foreground">
        <p>{t('terms.intro')}</p>
        <h2 className="text-xl font-semibold text-foreground">{t('terms.usage.heading')}</h2>
        <p>{t('terms.usage.body')}</p>
        <h2 className="text-xl font-semibold text-foreground">{t('terms.accounts.heading')}</h2>
        <p>{t('terms.accounts.body')}</p>
        <h2 className="text-xl font-semibold text-foreground">{t('terms.content.heading')}</h2>
        <p>{t('terms.content.body')}</p>
        <h2 className="text-xl font-semibold text-foreground">{t('terms.liability.heading')}</h2>
        <p>{t('terms.liability.body')}</p>
        <p className="text-sm">{t('lastUpdated', { date: '2026-05-15' })}</p>
      </div>
    </main>
  )
}
