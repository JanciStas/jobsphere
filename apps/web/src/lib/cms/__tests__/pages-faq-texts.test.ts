/**
 * Public CMS readers: fall back to the built-in content when the CMS tables are missing
 * (production before the migration), FAQ grouping / JSON-LD, and the cmsTexts override logic.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    cmsPage: { findFirst: vi.fn() },
    cmsFaqItem: { findMany: vi.fn() },
    cmsText: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { getPublishedCmsPage, cmsPageMetadata, isCmsPageSlug } from '../pages'
import { getPublishedFaq, groupFaqByCategory, buildFaqJsonLd } from '../faq'
import {
  CMS_TEXT_KEYS,
  cmsTexts,
  cmsTextKeysFor,
  cmsTextPath,
  getCmsTextOverrides,
  isCmsTextKey,
} from '../texts'

const p = prisma as any
const missingTable = (table: string) =>
  Object.assign(new Error(`The table \`public.${table}\` does not exist`), { code: 'P2021' })

beforeEach(() => vi.clearAllMocks())

describe('static pages', () => {
  it('returns null (built-in content) when the table is missing, without logging an error', async () => {
    p.cmsPage.findFirst.mockRejectedValue(missingTable('CmsPage'))
    expect(await getPublishedCmsPage('terms', 'sk')).toBeNull()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('returns null on any other DB error too (logged)', async () => {
    p.cmsPage.findFirst.mockRejectedValue(new Error('connection reset'))
    expect(await getPublishedCmsPage('privacy', 'en')).toBeNull()
    expect(logger.error).toHaveBeenCalled()
  })

  it('reads only the PUBLISHED row of slug + locale', async () => {
    const row = {
      title: 'T',
      body: 'B',
      seoTitle: null,
      seoDescription: null,
      updatedAt: new Date(),
    }
    p.cmsPage.findFirst.mockResolvedValue(row)
    expect(await getPublishedCmsPage('gdpr', 'de')).toBe(row)
    expect(p.cmsPage.findFirst.mock.calls[0][0].where).toEqual({
      slug: 'gdpr',
      locale: 'de',
      status: 'PUBLISHED',
    })
  })

  it('metadata prefers SEO fields, then title / plain-text body excerpt', () => {
    const base = { title: 'About', body: '## Who\n\nWe **build** things.', updatedAt: new Date() }
    expect(cmsPageMetadata({ ...base, seoTitle: 'SEO', seoDescription: 'Desc' })).toEqual({
      title: 'SEO',
      description: 'Desc',
    })
    expect(cmsPageMetadata({ ...base, seoTitle: ' ', seoDescription: null })).toEqual({
      title: 'About',
      description: 'Who We build things.',
    })
  })

  it('knows the fixed slugs', () => {
    expect(isCmsPageSlug('about')).toBe(true)
    expect(isCmsPageSlug('blog')).toBe(false)
  })
})

describe('FAQ', () => {
  it('returns [] when the table is missing', async () => {
    p.cmsFaqItem.findMany.mockRejectedValue(missingTable('CmsFaqItem'))
    expect(await getPublishedFaq('sk')).toEqual([])
  })

  it('reads published entries of the locale in sort order', async () => {
    p.cmsFaqItem.findMany.mockResolvedValue([])
    await getPublishedFaq('pl')
    const args = p.cmsFaqItem.findMany.mock.calls[0][0]
    expect(args.where).toEqual({ locale: 'pl', published: true })
    expect(args.orderBy[0]).toEqual({ sortOrder: 'asc' })
  })

  it('groups by category in fixed order; unknown categories go to general', () => {
    const items = [
      { id: '1', category: 'employers', question: 'E', answer: 'a' },
      { id: '2', category: 'general', question: 'G', answer: 'a' },
      { id: '3', category: 'legacy', question: 'L', answer: 'a' },
    ]
    expect(groupFaqByCategory(items).map((g) => [g.category, g.items.map((i) => i.id)])).toEqual([
      ['general', ['2', '3']],
      ['employers', ['1']],
    ])
    expect(groupFaqByCategory([])).toEqual([])
  })

  it('JSON-LD FAQPage uses plain-text answers', () => {
    const ld = buildFaqJsonLd([
      { id: '1', category: 'general', question: 'Q?', answer: '**Yes** <script>x</script>' },
    ])
    expect(ld['@type']).toBe('FAQPage')
    expect(ld.mainEntity[0].name).toBe('Q?')
    expect(ld.mainEntity[0].acceptedAnswer.text).toBe('Yes')
  })
})

describe('site texts', () => {
  it('whitelist: keys map to their public page', () => {
    expect(CMS_TEXT_KEYS.length).toBeGreaterThanOrEqual(10)
    expect(isCmsTextKey('hero.title')).toBe(true)
    expect(isCmsTextKey('auth.login.title')).toBe(false)
    expect(cmsTextPath('hero.title')).toBe('')
    expect(cmsTextPath('pricing.title')).toBe('/pricing')
    expect(cmsTextPath('forEmployers.cta.title')).toBe('/for-employers')
    expect(cmsTextKeysFor('pricing').every((k) => k.startsWith('pricing.'))).toBe(true)
  })

  it('overrides: {} when the table is missing', async () => {
    p.cmsText.findMany.mockRejectedValue(missingTable('CmsText'))
    expect(await getCmsTextOverrides('sk')).toEqual({})
  })

  it('overrides: no query for an unknown locale or non-whitelisted keys only', async () => {
    expect(await getCmsTextOverrides('xx')).toEqual({})
    expect(await getCmsTextOverrides('sk', ['nav.home'])).toEqual({})
    expect(p.cmsText.findMany).not.toHaveBeenCalled()
  })

  it('overrides: only whitelisted keys are queried, blank values ignored', async () => {
    p.cmsText.findMany.mockResolvedValue([
      { key: 'pricing.title', value: 'Ceny' },
      { key: 'pricing.subtitle', value: '   ' },
    ])
    const out = await getCmsTextOverrides('sk', ['pricing.title', 'pricing.subtitle', 'nav.home'])
    expect(out).toEqual({ 'pricing.title': 'Ceny' })
    expect(p.cmsText.findMany.mock.calls[0][0].where).toEqual({
      locale: 'sk',
      key: { in: ['pricing.title', 'pricing.subtitle'] },
    })
  })

  it('cmsTexts: override wins, otherwise the translator', async () => {
    p.cmsText.findMany.mockResolvedValue([{ key: 'hero.title', value: 'Vlastný nadpis' }])
    const t = vi.fn((key: string) => `built-in:${key}`)
    const tx = await cmsTexts('sk', t)
    expect(tx('hero.title')).toBe('Vlastný nadpis')
    expect(tx('hero.subtitle')).toBe('built-in:hero.subtitle')
    expect(t).toHaveBeenCalledWith('hero.subtitle')
  })

  it('cmsTexts: namespaced translator resolves the full key path', async () => {
    p.cmsText.findMany.mockResolvedValue([{ key: 'forEmployers.hero.title', value: 'Override' }])
    const t = (key: string) => `built-in:${key}`
    const tx = await cmsTexts('en', t, 'forEmployers')
    expect(tx('hero.title')).toBe('Override')
    expect(tx('cta.title')).toBe('built-in:cta.title')
    expect(p.cmsText.findMany.mock.calls[0][0].where.key.in).toEqual(cmsTextKeysFor('forEmployers'))
  })

  it('cmsTexts: falls back to the built-in texts when the table is missing', async () => {
    p.cmsText.findMany.mockRejectedValue(missingTable('CmsText'))
    const tx = await cmsTexts('sk', (key) => `built-in:${key}`)
    expect(tx('hero.title')).toBe('built-in:hero.title')
    expect(logger.error).not.toHaveBeenCalled()
  })
})
