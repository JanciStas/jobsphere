import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { ArrowLeft } from 'lucide-react'
import { LONG_DATE } from '@/lib/formats'
import { isCmsLocale } from '@/lib/cms/constants'
import { markdownToPlainText } from '@/lib/cms/markdown'
import { CmsContent } from '@/components/cms/cms-content'
import { categoryName, readingTimeMinutes } from '@/lib/blog/shared'
import { getPostLocales, getPublishedPost, getRelatedPosts } from '@/lib/blog/queries'
import { BlogCover } from '../_components/blog-cover'
import { PostCard } from '../_components/post-card'

// Scheduled posts go live when publishedAt passes; re-check every 5 minutes.
export const revalidate = 300

type Params = Promise<{ locale: string; slug: string }>

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://jobsphere.eu'

async function loadPost(locale: string, slug: string) {
  if (!isCmsLocale(locale)) return null
  return getPublishedPost(slug, locale)
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params
  const post = await loadPost(locale, slug)
  if (!post) {
    const t = await getTranslations({ locale, namespace: 'blog' })
    return { title: t('notFoundTitle'), robots: { index: false, follow: false } }
  }

  const title = post.seoTitle || post.title
  const description =
    post.seoDescription || post.excerpt || markdownToPlainText(post.body, 160) || undefined
  const url = `${APP_URL}/${locale}/blog/${post.slug}`
  const locales = await getPostLocales(post.slug)

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: Object.fromEntries(
        locales.map((l) => [l, `${APP_URL}/${l}/blog/${post.slug}`] as const),
      ),
    },
    openGraph: {
      title,
      description,
      type: 'article',
      url,
      locale,
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      tags: post.tags,
      ...(post.coverImage ? { images: [{ url: post.coverImage, alt: post.title }] } : {}),
    },
    twitter: {
      card: post.coverImage ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(post.coverImage ? { images: [post.coverImage] } : {}),
    },
  }
}

export default async function BlogPostPage({ params }: { params: Params }) {
  const { locale, slug } = await params
  const post = await loadPost(locale, slug)
  if (!post) notFound()

  const [t, format, related] = await Promise.all([
    getTranslations({ locale, namespace: 'blog' }),
    getFormatter({ locale }),
    getRelatedPosts(post),
  ])

  const url = `${APP_URL}/${locale}/blog/${post.slug}`
  const category = post.category
    ? {
        slug: post.category.slug,
        name: categoryName(post.category.names, locale, post.category.slug),
      }
    : null
  const minutes = readingTimeMinutes(post.body)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.seoDescription || post.excerpt || markdownToPlainText(post.body, 160),
    ...(post.coverImage ? { image: [post.coverImage] } : {}),
    datePublished: post.publishedAt?.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    inLanguage: locale,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    url,
    ...(category ? { articleSection: category.name } : {}),
    ...(post.tags.length ? { keywords: post.tags.join(', ') } : {}),
    timeRequired: `PT${minutes}M`,
    author: { '@type': 'Organization', name: 'JobSphere', url: APP_URL },
    publisher: { '@type': 'Organization', name: 'JobSphere', url: APP_URL },
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />

      <Link
        href={`/${locale}/blog`}
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('backToBlog')}
      </Link>

      <article>
        <header className="mb-8">
          <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {category && (
              <Link
                href={`/${locale}/blog?category=${category.slug}`}
                className="font-medium text-primary hover:underline"
              >
                {category.name}
              </Link>
            )}
            {post.publishedAt && (
              <time dateTime={post.publishedAt.toISOString()}>
                {format.dateTime(post.publishedAt, LONG_DATE)}
              </time>
            )}
            <span aria-hidden="true">·</span>
            <span>{t('readingTime', { minutes })}</span>
          </div>
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{post.title}</h1>
          {post.excerpt && <p className="mt-4 text-lg text-muted-foreground">{post.excerpt}</p>}
        </header>

        {post.coverImage && (
          <BlogCover src={post.coverImage} alt={post.title} priority className="mb-8 rounded-lg" />
        )}

        <CmsContent markdown={post.body} />

        {post.tags.length > 0 && (
          <div className="mt-10 border-t pt-6">
            <h2 className="sr-only">{t('tags')}</h2>
            <ul className="flex flex-wrap gap-2" aria-label={t('tags')}>
              {post.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"
                >
                  #{tag}
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>

      {related.length > 0 && (
        <section className="mt-14" aria-labelledby="related-posts">
          <h2 id="related-posts" className="mb-6 text-xl font-semibold">
            {t('relatedPosts')}
          </h2>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((p) => (
              <PostCard key={p.id} post={p} locale={locale} headingLevel={3} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
