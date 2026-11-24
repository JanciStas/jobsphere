/** Zod input schemas for the admin blog API (api/admin/cms/blog/**). */

import { z } from 'zod'
import { CMS_LOCALES, SLUG_MAX, SLUG_REGEX, isCmsLocale } from '@/lib/cms/constants'
import { MAX_MARKDOWN_LENGTH } from '@/lib/cms/markdown'
import {
  BLOG_CATEGORY_NAME_MAX,
  BLOG_EXCERPT_MAX,
  BLOG_SEO_DESCRIPTION_MAX,
  BLOG_SEO_TITLE_MAX,
  BLOG_TAGS_MAX,
  BLOG_TAG_LENGTH_MAX,
  BLOG_TITLE_MAX,
} from './shared'

/** '' and whitespace-only become null, so optional text fields can be cleared. */
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

const optionalText = (max: number) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable()).optional()

const locale = z.string().refine(isCmsLocale, { message: 'Unsupported locale' })

const slug = z
  .string()
  .trim()
  .min(1)
  .max(SLUG_MAX)
  .regex(SLUG_REGEX, { message: 'Slug may contain only a-z, 0-9 and single dashes' })

const httpsUrl = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((v) => v.startsWith('https://'), { message: 'Image URL must use https' })

const tags = z
  .array(z.string().trim().min(1).max(BLOG_TAG_LENGTH_MAX))
  .max(BLOG_TAGS_MAX)
  // Case-insensitive de-duplication, first spelling wins.
  .transform((list) => {
    const seen = new Set<string>()
    return list.filter((t) => {
      const key = t.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })

const postFields = {
  locale,
  title: z.string().trim().min(1).max(BLOG_TITLE_MAX),
  slug,
  excerpt: optionalText(BLOG_EXCERPT_MAX),
  body: z.string().min(1).max(MAX_MARKDOWN_LENGTH),
  coverImage: z.preprocess(emptyToNull, httpsUrl.nullable()).optional(),
  categoryId: z.preprocess(emptyToNull, z.string().min(1).max(64).nullable()).optional(),
  tags: tags.optional(),
  seoTitle: optionalText(BLOG_SEO_TITLE_MAX),
  seoDescription: optionalText(BLOG_SEO_DESCRIPTION_MAX),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
  /** ISO 8601 instant (the admin form converts Europe/Bratislava wall time before sending). */
  publishedAt: z
    .preprocess(emptyToNull, z.string().datetime({ offset: true }).nullable())
    .optional(),
}

export const createPostSchema = z.object(postFields).strict()
export const updatePostSchema = z
  .object(postFields)
  .partial()
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to change' })

export type CreatePostInput = z.infer<typeof createPostSchema>
export type UpdatePostInput = z.infer<typeof updatePostSchema>

/** `{ sk: 'Kariéra', en: 'Career' }` — only known locales, empty names dropped. */
const categoryNames = z
  .record(z.string(), z.string().trim().max(BLOG_CATEGORY_NAME_MAX))
  .refine((names) => Object.keys(names).every(isCmsLocale), { message: 'Unsupported locale' })
  .transform((names) => {
    const out: Record<string, string> = {}
    for (const l of CMS_LOCALES) {
      const value = Object.prototype.hasOwnProperty.call(names, l) ? names[l] : undefined
      if (value) out[l] = value
    }
    return out
  })
  .refine((names) => Object.keys(names).length > 0, { message: 'At least one name is required' })

export const createCategorySchema = z
  .object({ slug, names: categoryNames, sortOrder: z.number().int().min(0).max(10_000).optional() })
  .strict()

export const updateCategorySchema = z
  .object({
    slug: slug.optional(),
    names: categoryNames.optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Nothing to change' })

export const reorderCategoriesSchema = z
  .object({ order: z.array(z.string().min(1).max(64)).min(1).max(500) })
  .strict()
  .refine((d) => new Set(d.order).size === d.order.length, { message: 'Duplicate ids' })
