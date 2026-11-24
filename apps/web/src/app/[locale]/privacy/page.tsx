import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { CmsContent } from '@/components/cms/cms-content'
import { cmsPageMetadata, getPublishedCmsPage } from '@/lib/cms/pages'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const cms = await getPublishedCmsPage('privacy', locale)
  if (cms) return cmsPageMetadata(cms)
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('privacy.title'),
    description: t('privacy.description'),
  }
}

export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params
  const cms = await getPublishedCmsPage('privacy', locale)
  if (cms) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-12">
        <h1 className="mb-6 text-3xl font-bold">{cms.title}</h1>
        <CmsContent markdown={cms.body} />
      </main>
    )
  }

  const t = await getTranslations({ locale, namespace: 'legal' })
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
