import Link from 'next/link'
import type { Metadata } from 'next'
import { getFormatter, getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { SHORT_DATE } from '@/lib/formats'
import { CMS_LOCALES } from '@/lib/cms/constants'
import { isCmsTableMissing } from '@/lib/cms/safe'
import { CMS_PAGE_SLUGS } from '@/lib/cms/pages'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { NotMigratedNotice } from './_components/not-migrated-notice'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminCmsPages' })
  return { title: t('metaTitle') }
}

type Row = { slug: string; locale: string; title: string; status: string; updatedAt: Date }

/** Overview of the CMS static pages: slug × locale with the status of each version. */
export default async function AdminCmsPagesPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminCmsPages' })
  const format = await getFormatter({ locale })

  let rows: Row[] = []
  let migrated = true
  try {
    rows = await prisma.cmsPage.findMany({
      select: { slug: true, locale: true, title: true, status: true, updatedAt: true },
    })
  } catch (error) {
    if (!isCmsTableMissing(error)) throw error
    migrated = false
  }
  const byKey = new Map(rows.map((r) => [`${r.slug}/${r.locale}`, r]))

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!migrated && <NotMigratedNotice message={t('notMigrated')} />}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.page')}</TableHead>
                {CMS_LOCALES.map((l) => (
                  <TableHead key={l} className="uppercase">
                    {l}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {CMS_PAGE_SLUGS.map((slug) => (
                <TableRow key={slug}>
                  <TableCell>
                    <div className="font-medium">{t(`slugs.${slug}`)}</div>
                    <div className="text-xs text-muted-foreground">/{slug}</div>
                  </TableCell>
                  {CMS_LOCALES.map((l) => {
                    const row = byKey.get(`${slug}/${l}`)
                    return (
                      <TableCell key={l} className="align-top">
                        <Link
                          href={`/${locale}/admin/content/pages/${slug}/${l}`}
                          className="group inline-flex flex-col gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={t('editAria', {
                            page: t(`slugs.${slug}`),
                            lang: l.toUpperCase(),
                          })}
                        >
                          {row ? (
                            <Badge
                              className={
                                row.status === 'PUBLISHED'
                                  ? 'w-fit bg-green-100 text-green-800 hover:bg-green-100'
                                  : 'w-fit bg-amber-100 text-amber-800 hover:bg-amber-100'
                              }
                            >
                              {row.status === 'PUBLISHED'
                                ? t('status.published')
                                : t('status.draft')}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="w-fit">
                              {t('status.builtIn')}
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground group-hover:underline">
                            {row ? format.dateTime(row.updatedAt, SHORT_DATE) : t('create')}
                          </span>
                        </Link>
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">{t('legend')}</p>
      </CardContent>
    </Card>
  )
}
