/**
 * CMS static pages (terms, privacy, gdpr, about). One row per slug + locale; the public
 * page renders a PUBLISHED row and otherwise keeps its built-in i18n content.
 * Server-only (Prisma).
 */

import { revalidatePath } from 'next/cache'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { cmsRead } from './safe'
import { CMS_LOCALES } from './constants'
import { markdownToPlainText } from './markdown'

export const CMS_PAGE_SLUGS = ['terms', 'privacy', 'gdpr', 'about'] as const
export type CmsPageSlug = (typeof CMS_PAGE_SLUGS)[number]

export const CMS_PAGE_TITLE_MAX = 200
export const CMS_PAGE_SEO_TITLE_MAX = 120
export const CMS_PAGE_SEO_DESCRIPTION_MAX = 320

export function isCmsPageSlug(value: unknown): value is CmsPageSlug {
  return typeof value === 'string' && (CMS_PAGE_SLUGS as readonly string[]).includes(value)
}

export interface PublishedCmsPage {
  title: string
  body: string
  seoTitle: string | null
  seoDescription: string | null
  updatedAt: Date
}

/** The PUBLISHED page for slug + locale, or null (no row, draft, or tables not migrated). */
export async function getPublishedCmsPage(
  slug: CmsPageSlug,
  locale: string,
): Promise<PublishedCmsPage | null> {
  return cmsRead(
    `page ${slug}/${locale}`,
    () =>
      prisma.cmsPage.findFirst({
        where: { slug, locale, status: 'PUBLISHED' },
        select: { title: true, body: true, seoTitle: true, seoDescription: true, updatedAt: true },
      }),
    null,
  )
}

/** Metadata for a published CMS page: SEO fields first, then title / body excerpt. */
export function cmsPageMetadata(page: PublishedCmsPage): Metadata {
  return {
    title: page.seoTitle?.trim() || page.title,
    description: page.seoDescription?.trim() || markdownToPlainText(page.body, 160),
  }
}

/** Revalidate the public page in every locale after an admin write. */
export function revalidateCmsPage(slug: CmsPageSlug): void {
  for (const locale of CMS_LOCALES) revalidatePath(`/${locale}/${slug}`)
}
