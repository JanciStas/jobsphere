/**
 * Input validation for PUT /api/employer/career-page.
 *
 * Every field is optional: a missing key keeps the stored value, an empty string clears it.
 * Unknown keys (notably `orgId`) are stripped — the organization always comes from the session.
 */

import { z } from 'zod'
import { CAREER_LIMITS, isHexColor, isHttpsUrl, toVideoEmbedUrl } from './media'

/** Trimmed text; '' becomes null (clear), undefined stays undefined (keep). */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null))

const optionalChecked = (check: (v: string) => boolean, message: string) =>
  z
    .string()
    .trim()
    .max(CAREER_LIMITS.url)
    .nullable()
    .optional()
    .refine((v) => v === undefined || v === null || v === '' || check(v), { message })
    .transform((v) => (v === undefined ? undefined : v || null))

export const careerPageInputSchema = z.object({
  published: z.boolean().optional(),
  headline: optionalText(CAREER_LIMITS.headline),
  subheadline: optionalText(CAREER_LIMITS.subheadline),
  about: z
    .string()
    .max(CAREER_LIMITS.about)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v?.trim() ? v : null)),
  benefits: z
    .array(z.string().trim().max(CAREER_LIMITS.benefit))
    .max(CAREER_LIMITS.benefits)
    .optional()
    .transform((list) => list?.filter((b) => b.length > 0)),
  coverImage: optionalChecked(isHttpsUrl, 'Cover image must be an https URL'),
  brandColor: optionalChecked(isHexColor, 'Brand color must be a hex color like #1a2b3c'),
  videoUrl: optionalChecked(
    (v) => toVideoEmbedUrl(v) !== null,
    'Video must be an https YouTube or Vimeo link',
  ),
})

export type CareerPageInput = z.output<typeof careerPageInputSchema>

/** Editable fields of a CareerPage row, as returned to the settings tab. */
export interface CareerPageFields {
  published: boolean
  headline: string | null
  subheadline: string | null
  about: string | null
  benefits: string[]
  coverImage: string | null
  brandColor: string | null
  videoUrl: string | null
}

export const CAREER_PAGE_DEFAULTS: CareerPageFields = {
  published: false,
  headline: null,
  subheadline: null,
  about: null,
  benefits: [],
  coverImage: null,
  brandColor: null,
  videoUrl: null,
}

/** Pick only the editable fields (audit snapshots, API responses). */
export function pickCareerFields(row: CareerPageFields): CareerPageFields {
  return {
    published: row.published,
    headline: row.headline,
    subheadline: row.subheadline,
    about: row.about,
    benefits: row.benefits,
    coverImage: row.coverImage,
    brandColor: row.brandColor,
    videoUrl: row.videoUrl,
  }
}
