/**
 * CMS FAQ: published entries per locale, grouped by category for /[locale]/faq.
 * Server-only (Prisma).
 */

import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/prisma'
import { cmsRead } from './safe'
import { CMS_LOCALES } from './constants'
import { markdownToPlainText } from './markdown'

export const CMS_FAQ_CATEGORIES = ['general', 'candidates', 'employers'] as const
export type CmsFaqCategory = (typeof CMS_FAQ_CATEGORIES)[number]

export const CMS_FAQ_QUESTION_MAX = 300
export const CMS_FAQ_ANSWER_MAX = 20_000

/** Fields the admin API returns for an entry. */
export const FAQ_ADMIN_SELECT = {
  id: true,
  locale: true,
  category: true,
  question: true,
  answer: true,
  sortOrder: true,
  published: true,
  updatedAt: true,
} as const

export function isCmsFaqCategory(value: unknown): value is CmsFaqCategory {
  return typeof value === 'string' && (CMS_FAQ_CATEGORIES as readonly string[]).includes(value)
}

export interface PublicFaqItem {
  id: string
  category: string
  question: string
  answer: string
}

/** Published FAQ entries for a locale in display order; [] when none or not migrated. */
export async function getPublishedFaq(locale: string): Promise<PublicFaqItem[]> {
  return cmsRead(
    `faq ${locale}`,
    () =>
      prisma.cmsFaqItem.findMany({
        where: { locale, published: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, category: true, question: true, answer: true },
      }),
    [],
  )
}

/** Group in the fixed category order; an unknown category is shown under "general". */
export function groupFaqByCategory(
  items: PublicFaqItem[],
): Array<{ category: CmsFaqCategory; items: PublicFaqItem[] }> {
  return CMS_FAQ_CATEGORIES.map((category) => ({
    category,
    items: items.filter((item) =>
      category === 'general'
        ? item.category === 'general' || !isCmsFaqCategory(item.category)
        : item.category === category,
    ),
  })).filter((group) => group.items.length > 0)
}

/** schema.org FAQPage with plain-text answers. */
export function buildFaqJsonLd(items: PublicFaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: markdownToPlainText(item.answer, 5000),
      },
    })),
  }
}

export function revalidateFaq(): void {
  for (const locale of CMS_LOCALES) revalidatePath(`/${locale}/faq`)
}
