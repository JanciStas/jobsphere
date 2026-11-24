import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { ArrowLeft } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { isCmsLocale } from '@/lib/cms/constants'
import { isCmsTableMissing } from '@/lib/cms/safe'
import { isCmsPageSlug, type CmsPageSlug } from '@/lib/cms/pages'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { NotMigratedNotice } from '../../_components/not-migrated-notice'
import { PageEditForm } from '../../_components/page-edit-form'

type Props = { params: Promise<{ locale: string; slug: string; lang: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminCmsPages' })
  return { title: t('metaTitle') }
}

/** Legal section keys in messages `legal.<slug>.*`, in display order. */
const LEGAL_SECTIONS: Record<'terms' | 'privacy' | 'gdpr', string[]> = {
  terms: ['usage', 'accounts', 'content', 'liability'],
  privacy: ['dataCollected', 'dataUse', 'rights', 'contact'],
  gdpr: ['controller', 'rights', 'exercise'],
}
const GDPR_RIGHTS = ['access', 'rectify', 'erase', 'portability', 'object']

/**
 * Today's built-in content of a page as Markdown, so a new CMS version starts from the
 * text visitors currently see instead of an empty editor.
 */
async function builtInPage(slug: CmsPageSlug, lang: string) {
  const meta = await getTranslations({ locale: lang, namespace: 'pageMetadata' })
  const seo = { seoTitle: meta(`${slug}.title`), seoDescription: meta(`${slug}.description`) }

  if (slug === 'about') {
    const t = await getTranslations({ locale: lang, namespace: 'about' })
    const body = [
      t('intro'),
      `## ${t('mission.heading')}`,
      t('mission.body'),
      `## ${t('team.heading')}`,
      t('team.body'),
    ].join('\n\n')
    return { title: t('title'), body, ...seo }
  }

  const t = await getTranslations({ locale: lang, namespace: 'legal' })
  const parts = [t(`${slug}.intro`)]
  for (const section of LEGAL_SECTIONS[slug]) {
    parts.push(`## ${t(`${slug}.${section}.heading`)}`)
    if (slug === 'gdpr' && section === 'rights') {
      parts.push(GDPR_RIGHTS.map((r) => `- ${t(`gdpr.rights.${r}`)}`).join('\n'))
    } else {
      parts.push(t(`${slug}.${section}.body`))
    }
  }
  return { title: t(`${slug}.title`), body: parts.join('\n\n'), ...seo }
}

export default async function AdminCmsPageEdit({ params }: Props) {
  const { locale, slug, lang } = await params
  if (!isCmsPageSlug(slug) || !isCmsLocale(lang)) notFound()
  const t = await getTranslations({ locale, namespace: 'adminCmsPages' })

  let migrated = true
  let existing: {
    title: string
    body: string
    seoTitle: string | null
    seoDescription: string | null
    status: 'DRAFT' | 'PUBLISHED'
  } | null = null
  try {
    existing = await prisma.cmsPage.findUnique({
      where: { slug_locale: { slug, locale: lang } },
      select: { title: true, body: true, seoTitle: true, seoDescription: true, status: true },
    })
  } catch (error) {
    if (!isCmsTableMissing(error)) throw error
    migrated = false
  }

  const initial = existing
    ? {
        title: existing.title,
        body: existing.body,
        seoTitle: existing.seoTitle ?? '',
        seoDescription: existing.seoDescription ?? '',
        status: existing.status,
      }
    : { ...(await builtInPage(slug, lang)), status: 'DRAFT' as const }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <Link
          href={`/${locale}/admin/content/pages`}
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('back')}
        </Link>
        <CardTitle>
          {t('editTitle', { page: t(`slugs.${slug}`), lang: lang.toUpperCase() })}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {existing ? t('editExisting') : t('editNew')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!migrated && <NotMigratedNotice message={t('notMigrated')} />}
        <PageEditForm
          slug={slug}
          lang={lang}
          exists={Boolean(existing)}
          initial={initial}
          backHref={`/${locale}/admin/content/pages`}
          publicHref={`/${lang}/${slug}`}
        />
      </CardContent>
    </Card>
  )
}
