import type { MetadataRoute } from 'next'
import { prisma } from '@/lib/prisma'
import { cmsRead } from '@/lib/cms/safe'
import { publishedWhere } from './queries'

/** Live blog posts for sitemap.xml (scheduled and draft posts excluded). Never throws. */
export async function getBlogSitemapEntries(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  try {
    const posts = await cmsRead(
      'blog.sitemap',
      () =>
        prisma.blogPost.findMany({
          where: publishedWhere(),
          select: { slug: true, locale: true, updatedAt: true },
          orderBy: { publishedAt: 'desc' },
          take: 5000,
        }),
      [] as { slug: string; locale: string; updatedAt: Date }[],
    )
    return posts.map((post) => ({
      url: `${baseUrl}/${post.locale}/blog/${post.slug}`,
      lastModified: post.updatedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    }))
  } catch {
    return []
  }
}
