import Link from 'next/link'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { CMS_LOCALES, isCmsLocale } from '@/lib/cms/constants'
import { isCmsTableMissing } from '@/lib/cms/safe'
import { CMS_FAQ_CATEGORIES } from '@/lib/cms/faq'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NotMigratedNotice } from '../pages/_components/not-migrated-notice'
import { FaqManager, type AdminFaqItem } from './_components/faq-manager'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ lang?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminCmsFaq' })
  return { title: t('metaTitle') }
}

/** FAQ entries of one locale: create, edit, publish, reorder, delete. */
export default async function AdminCmsFaqPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { lang: rawLang } = await searchParams
  const lang = isCmsLocale(rawLang) ? rawLang : isCmsLocale(locale) ? locale : 'sk'
  const t = await getTranslations({ locale, namespace: 'adminCmsFaq' })

  let items: AdminFaqItem[] = []
  let migrated = true
  try {
    items = await prisma.cmsFaqItem.findMany({
      where: { locale: lang },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, category: true, question: true, answer: true, published: true },
    })
  } catch (error) {
    if (!isCmsTableMissing(error)) throw error
    migrated = false
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <nav aria-label={t('languageLabel')} className="flex flex-wrap gap-1">
          {CMS_LOCALES.map((l) => (
            <Link
              key={l}
              href={`/${locale}/admin/content/faq?lang=${l}`}
              aria-current={l === lang ? 'page' : undefined}
              className={`rounded-md border px-3 py-1 text-sm font-medium uppercase ${
                l === lang ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {l}
            </Link>
          ))}
        </nav>
      </CardHeader>
      <CardContent className="space-y-4">
        {!migrated && <NotMigratedNotice message={t('notMigrated')} />}
        <FaqManager
          key={lang}
          lang={lang}
          items={items}
          categories={[...CMS_FAQ_CATEGORIES]}
          publicHref={`/${lang}/faq`}
        />
      </CardContent>
    </Card>
  )
}
