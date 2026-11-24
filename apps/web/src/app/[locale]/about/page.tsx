import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { CmsContent } from '@/components/cms/cms-content'
import { cmsPageMetadata, getPublishedCmsPage } from '@/lib/cms/pages'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const cms = await getPublishedCmsPage('about', locale)
  if (cms) return cmsPageMetadata(cms)
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('about.title'),
    description: t('about.description'),
  }
}

export default async function AboutPage({ params }: Props) {
  const { locale } = await params
  const cms = await getPublishedCmsPage('about', locale)
  if (cms) {
    return (
      <main className="container mx-auto max-w-3xl px-4 py-12">
        <h1 className="mb-6 text-3xl font-bold">{cms.title}</h1>
        <CmsContent markdown={cms.body} />
      </main>
    )
  }

  const t = await getTranslations({ locale, namespace: 'about' })
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
