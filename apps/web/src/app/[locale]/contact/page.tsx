import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('contact.title'),
    description: t('contact.description'),
  }
}

export default async function ContactPage() {
  const t = await getTranslations('contact')
  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">{t('title')}</h1>
      <div className="space-y-6 text-muted-foreground">
        <p>{t('intro')}</p>
        <dl className="space-y-3 rounded-lg border p-6">
          <div>
            <dt className="font-semibold text-foreground">{t('general')}</dt>
            <dd>
              <a className="text-primary hover:underline" href="mailto:hello@jobsphere.eu">
                hello@jobsphere.eu
              </a>
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">{t('privacy')}</dt>
            <dd>
              <a className="text-primary hover:underline" href="mailto:privacy@jobsphere.eu">
                privacy@jobsphere.eu
              </a>
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-foreground">{t('gdprDpo')}</dt>
            <dd>
              <a className="text-primary hover:underline" href="mailto:gdpr@jobsphere.eu">
                gdpr@jobsphere.eu
              </a>
            </dd>
          </div>
        </dl>
      </div>
    </main>
  )
}
