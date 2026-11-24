/**
 * Public reads for employer career pages. Every reader degrades (null / []) when the
 * CareerPage table is not migrated yet or the DB fails — public pages must never 500.
 */

import { cache } from 'react'
import { prisma } from '@/lib/prisma'
import { cmsRead } from '@/lib/cms/safe'
import { PERSONAL_ORG_SLUG } from '@/lib/identity'

const PUBLIC_CAREER_SELECT = {
  id: true,
  name: true,
  slug: true,
  logo: true,
  website: true,
  industry: true,
  size: true,
  careerPage: {
    select: {
      headline: true,
      subheadline: true,
      about: true,
      benefits: true,
      coverImage: true,
      brandColor: true,
      videoUrl: true,
      updatedAt: true,
    },
  },
} as const

/**
 * The organization behind `/careers/[slug]` — only when it is not suspended/deleted and its
 * career page is published. Cached per request (generateMetadata + page share one query).
 */
export const getPublicCareerPage = cache(async (slug: string) => {
  if (!slug || slug === PERSONAL_ORG_SLUG || slug.length > 200) return null
  const org = await cmsRead(
    'career page',
    () =>
      prisma.organization.findFirst({
        where: { slug, deletedAt: null, careerPage: { is: { published: true } } },
        select: PUBLIC_CAREER_SELECT,
      }),
    null,
  )
  if (!org?.careerPage) return null
  return { ...org, careerPage: org.careerPage }
})

export type PublicCareerPage = NonNullable<Awaited<ReturnType<typeof getPublicCareerPage>>>

/** Open positions shown on the career page. */
export async function getCareerJobs(orgId: string) {
  return cmsRead(
    'career jobs',
    () =>
      prisma.job.findMany({
        where: { orgId, status: 'PUBLISHED', deletedAt: null },
        select: {
          id: true,
          title: true,
          city: true,
          region: true,
          employmentType: true,
          publishedAt: true,
        },
        orderBy: { publishedAt: 'desc' },
        take: 50,
      }),
    [],
  )
}

/** Slug of the org's published career page (for the company profile link), else null. */
export async function getPublishedCareerSlug(orgId: string): Promise<string | null> {
  const page = await cmsRead(
    'career page link',
    () =>
      prisma.careerPage.findFirst({
        where: { orgId, published: true, organization: { deletedAt: null } },
        select: { organization: { select: { slug: true } } },
      }),
    null,
  )
  const slug = page?.organization.slug
  return slug && slug !== PERSONAL_ORG_SLUG ? slug : null
}
