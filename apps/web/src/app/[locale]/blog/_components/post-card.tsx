import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { LONG_DATE } from '@/lib/formats'
import { markdownToPlainText } from '@/lib/cms/markdown'
import { categoryName, readingTimeMinutes } from '@/lib/blog/shared'
import type { BlogListPost } from '@/lib/blog/queries'
import { BlogCover } from './blog-cover'

export async function PostCard({
  post,
  locale,
  headingLevel = 2,
}: {
  post: BlogListPost
  locale: string
  headingLevel?: 2 | 3
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const t = await getTranslations({ locale, namespace: 'blog' })
  const format = await getFormatter({ locale })
  const href = `/${locale}/blog/${post.slug}`
  const excerpt = post.excerpt || markdownToPlainText(post.body, 180)

  return (
    <article className="group flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm transition-shadow hover:shadow-md">
      {post.coverImage && (
        <Link href={href} tabIndex={-1} aria-hidden="true">
          <BlogCover
            src={post.coverImage}
            alt=""
            sizes="(min-width: 1024px) 384px, (min-width: 640px) 50vw, 100vw"
          />
        </Link>
      )}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {post.category && (
            <Link
              href={`/${locale}/blog?category=${post.category.slug}`}
              className="font-medium text-primary hover:underline"
            >
              {categoryName(post.category.names, locale, post.category.slug)}
            </Link>
          )}
          {post.publishedAt && (
            <time dateTime={post.publishedAt.toISOString()}>
              {format.dateTime(post.publishedAt, LONG_DATE)}
            </time>
          )}
          <span aria-hidden="true">·</span>
          <span>{t('readingTime', { minutes: readingTimeMinutes(post.body) })}</span>
        </div>
        <Heading className="text-lg font-semibold leading-snug">
          <Link href={href} className="hover:text-primary">
            {post.title}
          </Link>
        </Heading>
        {excerpt && <p className="line-clamp-3 text-sm text-muted-foreground">{excerpt}</p>}
        <Link
          href={href}
          className="mt-auto text-sm font-medium text-primary hover:underline"
          aria-label={`${t('readMore')}: ${post.title}`}
        >
          {t('readMore')} →
        </Link>
      </div>
    </article>
  )
}
