import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import type { Prisma } from '@prisma/client'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parsePageNumber } from '@/lib/admin/paging'
import { SHORT_DATE_TIME } from '@/lib/formats'
import { CMS_LOCALES, isCmsLocale } from '@/lib/cms/constants'
import { isCmsTableMissing } from '@/lib/cms/safe'
import { categoryName, isLive, isScheduled } from '@/lib/blog/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { DeletePostButton } from './_components/delete-post-button'
import { NotMigratedNotice } from './_components/not-migrated-notice'

const PAGE_SIZE = 50
const STATUSES = ['DRAFT', 'PUBLISHED', 'SCHEDULED'] as const
type StatusFilter = (typeof STATUSES)[number]

const SELECT_CLASS =
  'flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

type Params = Promise<{ locale: string }>
type SearchParams = Promise<{ locale?: string; status?: string; page?: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminBlog' })
  return { title: t('metaTitle') }
}

export default async function AdminBlogPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const { locale } = await params
  const sp = await searchParams
  const session = await auth()
  if (!session?.user?.isGlobalAdmin) redirect(`/${locale}/login/admin?error=forbidden`)

  const t = await getTranslations({ locale, namespace: 'adminBlog' })
  const format = await getFormatter({ locale })

  const localeFilter = isCmsLocale(sp.locale) ? sp.locale : undefined
  const statusFilter = (STATUSES as readonly string[]).includes(sp.status ?? '')
    ? (sp.status as StatusFilter)
    : undefined
  const page = parsePageNumber(sp.page)
  const now = new Date()

  const where: Prisma.BlogPostWhereInput = {
    ...(localeFilter ? { locale: localeFilter } : {}),
    ...(statusFilter === 'DRAFT' ? { status: 'DRAFT' } : {}),
    ...(statusFilter === 'PUBLISHED' ? { status: 'PUBLISHED', publishedAt: { lte: now } } : {}),
    ...(statusFilter === 'SCHEDULED' ? { status: 'PUBLISHED', publishedAt: { gt: now } } : {}),
  }

  let data
  try {
    const [posts, total] = await Promise.all([
      prisma.blogPost.findMany({
        where,
        select: {
          id: true,
          slug: true,
          locale: true,
          title: true,
          status: true,
          publishedAt: true,
          updatedAt: true,
          category: { select: { slug: true, names: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.blogPost.count({ where }),
    ])
    data = { posts, total }
  } catch (error) {
    if (isCmsTableMissing(error)) return <NotMigratedNotice />
    throw error
  }

  const { posts, total } = data
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageHref = (p: number) => {
    const qs = new URLSearchParams()
    if (localeFilter) qs.set('locale', localeFilter)
    if (statusFilter) qs.set('status', statusFilter)
    if (p > 1) qs.set('page', String(p))
    const q = qs.toString()
    return `/${locale}/admin/content/blog${q ? `?${q}` : ''}`
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="blog-filter-locale" className="text-sm font-medium">
              {t('filters.locale')}
            </label>
            <select
              id="blog-filter-locale"
              name="locale"
              defaultValue={localeFilter ?? ''}
              className={SELECT_CLASS}
            >
              <option value="">{t('filters.allLocales')}</option>
              {CMS_LOCALES.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="blog-filter-status" className="text-sm font-medium">
              {t('filters.status')}
            </label>
            <select
              id="blog-filter-status"
              name="status"
              defaultValue={statusFilter ?? ''}
              className={SELECT_CLASS}
            >
              <option value="">{t('filters.allStatuses')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="outline">
            {t('filters.apply')}
          </Button>
        </form>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/${locale}/admin/content/blog/categories`}>{t('categoriesLink')}</Link>
          </Button>
          <Button asChild>
            <Link href={`/${locale}/admin/content/blog/new`}>{t('newPost')}</Link>
          </Button>
        </div>
      </div>

      {posts.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.title')}</TableHead>
                <TableHead>{t('columns.locale')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
                <TableHead>{t('columns.category')}</TableHead>
                <TableHead>{t('columns.publishedAt')}</TableHead>
                <TableHead>{t('columns.updatedAt')}</TableHead>
                <TableHead className="text-right">{t('columns.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((post) => {
                const scheduled = isScheduled(post, now)
                const live = isLive(post, now)
                return (
                  <TableRow key={post.id}>
                    <TableCell className="max-w-xs">
                      <Link
                        href={`/${locale}/admin/content/blog/${post.id}`}
                        className="font-medium hover:underline"
                      >
                        {post.title}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">/{post.slug}</div>
                    </TableCell>
                    <TableCell>{post.locale.toUpperCase()}</TableCell>
                    <TableCell>
                      {post.status === 'DRAFT' ? (
                        <Badge variant="secondary">{t('status.DRAFT')}</Badge>
                      ) : scheduled ? (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                          {t('status.SCHEDULED')}
                        </Badge>
                      ) : (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                          {t('status.PUBLISHED')}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {post.category
                        ? categoryName(post.category.names, locale, post.category.slug)
                        : '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {post.publishedAt ? format.dateTime(post.publishedAt, SHORT_DATE_TIME) : '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {format.dateTime(post.updatedAt, SHORT_DATE_TIME)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/${locale}/admin/content/blog/${post.id}`}>
                            {t('actions.edit')}
                          </Link>
                        </Button>
                        {live && (
                          <Button asChild size="sm" variant="ghost">
                            <a
                              href={`/${post.locale}/blog/${post.slug}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {t('actions.view')}
                            </a>
                          </Button>
                        )}
                        <DeletePostButton id={post.id} title={post.title} />
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {pageCount > 1 && (
        <nav aria-label={t('pagination')} className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={pageHref(page - 1)}>← {t('previous')}</Link> : <span />}
          <span className="text-muted-foreground">{t('pageOf', { page, total: pageCount })}</span>
          {page < pageCount ? <Link href={pageHref(page + 1)}>{t('next')} →</Link> : <span />}
        </nav>
      )}
    </div>
  )
}
