import type { MetadataRoute } from 'next'

/** Published blog posts for sitemap.xml. Implemented by the blog feature (never throws). */
export async function getBlogSitemapEntries(_baseUrl: string): Promise<MetadataRoute.Sitemap> {
  return []
}
