import { z } from 'zod'

const protocolUrl = (protocols: string[]) =>
  z
    .string()
    .trim()
    .max(500)
    .url()
    .refine((v) => {
      try {
        return protocols.includes(new URL(v).protocol)
      } catch {
        return false
      }
    }, 'Invalid URL protocol')

export const httpUrl = protocolUrl(['http:', 'https:'])
export const httpsUrl = protocolUrl(['https:'])

const tags = z.array(z.string().trim().min(1).max(30)).max(10)

export const createPortfolioSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  url: httpUrl.nullable().optional(),
  imageUrl: httpsUrl.nullable().optional(),
  tags: tags.optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
})

export const updatePortfolioSchema = createPortfolioSchema.partial()
