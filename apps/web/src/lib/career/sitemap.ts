import type { MetadataRoute } from 'next'
import { prisma } from '@/lib/prisma'
import { cmsRead } from '@/lib/cms/safe'
import { CMS_LOCALES } from '@/lib/cms/constants'
import { PERSONAL_ORG_SLUG } from '@/lib/identity'
import { careerPagePath } from './media'

/**
 * Published career pages of non-suspended orgs for sitemap.xml, in every locale.
 * Never throws: a missing table or DB error yields [].
 */
export async function getCareerSitemapEntries(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  try {
    const pages = await cmsRead(
      'career sitemap',
      () =>
        prisma.careerPage.findMany({
          where: { published: true, organization: { deletedAt: null } },
          select: { updatedAt: true, organization: { select: { slug: true } } },
          orderBy: { updatedAt: 'desc' },
          take: 1000,
        }),
      [],
    )
    return pages
      .filter((p) => p.organization.slug && p.organization.slug !== PERSONAL_ORG_SLUG)
      .flatMap((p) =>
        CMS_LOCALES.map((locale) => ({
          url: `${baseUrl}${careerPagePath(locale, p.organization.slug)}`,
          lastModified: p.updatedAt,
          changeFrequency: 'weekly' as const,
          priority: 0.6,
        })),
      )
  } catch {
    return []
  }
}
