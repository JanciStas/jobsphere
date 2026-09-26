import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('features.title'),
    description: t('features.description'),
  }
}

export default async function FeaturesPage() {
  const t = await getTranslations('featuresPage')
  return (
    <main className="container mx-auto max-w-4xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">{t('title')}</h1>
      <p className="mb-8 text-muted-foreground">{t('intro')}</p>
      <div className="grid gap-6 md:grid-cols-2">
        {['ai', 'parsing', 'pipeline', 'analytics', 'email', 'assessments'].map((key) => (
          <section key={key} className="rounded-lg border p-6">
            <h2 className="mb-2 text-xl font-semibold">{t(`${key}.heading`)}</h2>
            <p className="text-sm text-muted-foreground">{t(`${key}.body`)}</p>
          </section>
        ))}
      </div>
    </main>
  )
}
