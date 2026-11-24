import { getTranslations } from 'next-intl/server'
import { ContentTabs } from './_components/content-tabs'

/** "Obsah" section of the super admin: pages, FAQ, site texts, blog, announcements. */
export default async function AdminContentLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminContent' })
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>
      <ContentTabs locale={locale} />
      {children}
    </div>
  )
}
