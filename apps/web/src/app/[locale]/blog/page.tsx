import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { CMS_LOCALES } from '@/lib/cms/constants'
import { categoryName } from '@/lib/blog/shared'
import { listBlogCategories, listPublishedPosts } from '@/lib/blog/queries'
import { PostCard } from './_components/post-card'

// Scheduled posts appear once their publishedAt passes; re-check every 5 minutes.
export const revalidate = 300

type Params = Promise<{ locale: string }>
type SearchParams = Promise<{ category?: string | string[]; page?: string | string[] }>

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function parsePage(raw: string | undefined): number {
  const n = Math.floor(Number(raw ?? '1'))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1
}

function blogHref(locale: string, category: string | undefined, page: number) {
  const qs = new URLSearchParams()
  if (category) qs.set('category', category)
  if (page > 1) qs.set('page', String(page))
  const query = qs.toString()
  return `/${locale}/blog${query ? `?${query}` : ''}`
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}): Promise<Metadata> {
  const { locale } = await params
  const sp = await searchParams
  const category = first(sp.category)
  const page = parsePage(first(sp.page))
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  const tb = await getTranslations({ locale, namespace: 'blog' })
  const title = page > 1 ? tb('pageTitleWithPage', { page }) : t('blog.title')
  return {
    title,
    description: t('blog.description'),
    alternates: {
      canonical: `${APP_URL}${blogHref(locale, category, page)}`,
      languages: Object.fromEntries(CMS_LOCALES.map((l) => [l, `${APP_URL}/${l}/blog`])),
    },
    openGraph: {
      title,
      description: t('blog.description'),
      type: 'website',
      url: `${APP_URL}/${locale}/blog`,
    },
  }
}

export default async function BlogPage({
  params,
  searchParams,
}: {
  params: Params
  searchParams: SearchParams
}) {
  const { locale } = await params
  const sp = await searchParams
  const categorySlug = first(sp.category) || undefined
  const page = parsePage(first(sp.page))
  const t = await getTranslations({ locale, namespace: 'blog' })

  const [{ posts, total, pageCount }, categories] = await Promise.all([
    listPublishedPosts(locale, { categorySlug, page }),
    listBlogCategories(locale),
  ])

  // No posts at all (or CMS tables not migrated yet): keep the original "coming soon" page.
  if (total === 0 && !categorySlug) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <h1 className="mb-6 text-3xl font-bold">{t('title')}</h1>
        <p className="mb-8 text-muted-foreground">{t('comingSoon')}</p>
        <Link
          href={`/${locale}/jobs`}
          className="inline-flex items-center text-primary hover:underline"
        >
          {t('browseJobs')} →
        </Link>
      </div>
    )
  }

  const activeCategory = categories.find((c) => c.slug === categorySlug)

  return (
    <div className="container mx-auto max-w-6xl px-4 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold">
          {activeCategory
            ? `${t('title')}: ${categoryName(activeCategory.names, locale, activeCategory.slug)}`
            : t('title')}
        </h1>
        <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>
      </header>

      {categories.length > 0 && (
        <nav aria-label={t('categoriesLabel')} className="mb-8 flex flex-wrap gap-2">
          <CategoryChip href={`/${locale}/blog`} active={!categorySlug}>
            {t('allCategories')}
          </CategoryChip>
          {categories.map((c) => (
            <CategoryChip
              key={c.id}
              href={blogHref(locale, c.slug, 1)}
              active={c.slug === categorySlug}
            >
              {categoryName(c.names, locale, c.slug)}
            </CategoryChip>
          ))}
        </nav>
      )}

      {posts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <p>{categorySlug ? t('noPostsInCategory') : t('noPostsOnPage')}</p>
          <Link href={`/${locale}/blog`} className="mt-4 inline-block text-primary hover:underline">
            {t('backToBlog')}
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} locale={locale} />
          ))}
        </div>
      )}

      {pageCount > 1 && (
        <nav
          aria-label={t('pagination.label')}
          className="mt-10 flex items-center justify-between gap-4"
        >
          {page > 1 ? (
            <Link
              href={blogHref(locale, categorySlug, page - 1)}
              rel="prev"
              className="text-sm font-medium text-primary hover:underline"
            >
              ← {t('pagination.previous')}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted-foreground">
            {t('pagination.pageOf', { page, total: pageCount })}
          </span>
          {page < pageCount ? (
            <Link
              href={blogHref(locale, categorySlug, page + 1)}
              rel="next"
              className="text-sm font-medium text-primary hover:underline"
            >
              {t('pagination.next')} →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  )
}

function CategoryChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'hover:border-primary hover:text-primary'
      }`}
    >
      {children}
    </Link>
  )
}
