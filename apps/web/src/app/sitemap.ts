import { MetadataRoute } from 'next'
import { prisma } from '@/lib/prisma'
import { getBlogSitemapEntries } from '@/lib/blog/sitemap'
import { getCareerSitemapEntries } from '@/lib/career/sitemap'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://jobsphere.com'
const locales = ['en', 'de', 'cs', 'sk', 'pl']

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages = [
    '',
    '/jobs',
    '/pricing',
    '/for-employers',
    '/academy',
    '/blog',
    '/faq',
    '/login',
    '/signup',
  ]

  const staticEntries = locales.flatMap((locale) =>
    staticPages.map((page) => ({
      url: `${BASE_URL}/${locale}${page}`,
      lastModified: new Date(),
      changeFrequency: (page === '' ? 'weekly' : 'monthly') as 'weekly' | 'monthly',
      priority: page === '' ? 1.0 : 0.8,
    })),
  )

  let jobEntries: MetadataRoute.Sitemap = []
  try {
    const jobs = await prisma.job.findMany({
      where: { status: 'PUBLISHED' },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 1000,
    })

    jobEntries = locales.flatMap((locale) =>
      jobs.map((job) => ({
        url: `${BASE_URL}/${locale}/jobs/${job.id}`,
        lastModified: job.updatedAt,
        changeFrequency: 'daily' as const,
        priority: 0.7,
      })),
    )
  } catch {
    // DB not available during build — skip dynamic entries
  }

  const [blogEntries, careerEntries] = await Promise.all([
    getBlogSitemapEntries(BASE_URL),
    getCareerSitemapEntries(BASE_URL),
  ])

  return [...staticEntries, ...jobEntries, ...blogEntries, ...careerEntries]
}
