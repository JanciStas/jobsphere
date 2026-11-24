import Link from 'next/link'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { CMS_LOCALES, isCmsLocale } from '@/lib/cms/constants'
import { isCmsTableMissing } from '@/lib/cms/safe'
import { CMS_TEXT_KEYS, CMS_TEXT_MAX_LENGTH, cmsTextPath } from '@/lib/cms/texts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NotMigratedNotice } from '../pages/_components/not-migrated-notice'
import { TextsEditor, type TextRow } from './_components/texts-editor'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ lang?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminCmsTexts' })
  return { title: t('metaTitle') }
}

const GROUP_BY_PATH = {
  '': 'home',
  '/pricing': 'pricing',
  '/for-employers': 'forEmployers',
} as const

/** Whitelisted site texts of one locale: built-in text + optional admin override. */
export default async function AdminCmsTextsPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { lang: rawLang } = await searchParams
  const lang = isCmsLocale(rawLang) ? rawLang : isCmsLocale(locale) ? locale : 'sk'
  const t = await getTranslations({ locale, namespace: 'adminCmsTexts' })
  const builtIn = await getTranslations({ locale: lang })

  let overrides = new Map<string, string>()
  let migrated = true
  try {
    const rows = await prisma.cmsText.findMany({
      where: { locale: lang },
      select: { key: true, value: true },
    })
    overrides = new Map(rows.map((r) => [r.key, r.value]))
  } catch (error) {
    if (!isCmsTableMissing(error)) throw error
    migrated = false
  }

  const rows: TextRow[] = CMS_TEXT_KEYS.map((key) => ({
    key,
    group: GROUP_BY_PATH[cmsTextPath(key)],
    label: t(`labels.${key.replace(/\./g, '_')}`),
    builtIn: builtIn(key),
    override: overrides.get(key) ?? null,
  }))

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
        <nav aria-label={t('languageLabel')} className="flex flex-wrap gap-1">
          {CMS_LOCALES.map((l) => (
            <Link
              key={l}
              href={`/${locale}/admin/content/texts?lang=${l}`}
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
        <TextsEditor key={lang} lang={lang} rows={rows} maxLength={CMS_TEXT_MAX_LENGTH} />
      </CardContent>
    </Card>
  )
}
