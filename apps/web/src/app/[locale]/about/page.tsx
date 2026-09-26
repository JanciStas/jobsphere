import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('about.title'),
    description: t('about.description'),
  }
}

export default async function AboutPage() {
  const t = await getTranslations('about')
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">{t('title')}</h1>
      <div className="prose prose-slate max-w-none space-y-4 text-muted-foreground">
        <p>{t('intro')}</p>
        <h2 className="text-xl font-semibold text-foreground">{t('mission.heading')}</h2>
        <p>{t('mission.body')}</p>
        <h2 className="text-xl font-semibold text-foreground">{t('team.heading')}</h2>
        <p>{t('team.body')}</p>
      </div>
    </main>
  )
}
