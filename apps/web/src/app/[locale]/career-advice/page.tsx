import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('careerAdvice.title'),
    description: t('careerAdvice.description'),
  }
}

export default async function CareerAdvicePage() {
  const t = await getTranslations('careerAdvice')
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">{t('title')}</h1>
      <div className="prose prose-slate max-w-none space-y-6 text-muted-foreground">
        <p>{t('intro')}</p>
        <section>
          <h2 className="text-xl font-semibold text-foreground">{t('cv.heading')}</h2>
          <p>{t('cv.body')}</p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-foreground">{t('interview.heading')}</h2>
          <p>{t('interview.body')}</p>
        </section>
        <section>
          <h2 className="text-xl font-semibold text-foreground">{t('negotiation.heading')}</h2>
          <p>{t('negotiation.body')}</p>
        </section>
      </div>
    </main>
  )
}
