import type { MetadataRoute } from 'next'

/** Published career pages for sitemap.xml. Implemented by the career-page feature (never throws). */
export async function getCareerSitemapEntries(_baseUrl: string): Promise<MetadataRoute.Sitemap> {
  return []
}
