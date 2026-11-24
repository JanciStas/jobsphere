/**
 * Public career-page reads: only published pages of live (non-suspended) orgs are visible,
 * and a missing CareerPage table degrades to "not found" / [] instead of throwing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
// React.cache only exists in the server (RSC) build Next bundles; the test runtime has React 18.
vi.mock('react', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  cache: <T>(fn: T) => fn,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
    careerPage: { findFirst: vi.fn(), findMany: vi.fn() },
    job: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/prisma'
import { getPublicCareerPage, getCareerJobs, getPublishedCareerSlug } from '../queries'
import { getCareerSitemapEntries } from '../sitemap'

const missingTable = Object.assign(new Error('relation "CareerPage" does not exist'), {
  code: 'P2021',
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getPublicCareerPage', () => {
  it('requires a published page and a non-deleted org', async () => {
    ;(prisma.organization.findFirst as any).mockResolvedValue({
      id: 'org-1',
      name: 'Acme',
      slug: 'acme',
      careerPage: { headline: 'Hi', benefits: [] },
    })
    const org = await getPublicCareerPage('acme')
    expect(org?.careerPage.headline).toBe('Hi')
    const args = (prisma.organization.findFirst as any).mock.calls[0][0]
    expect(args.where).toEqual({
      slug: 'acme',
      deletedAt: null,
      careerPage: { is: { published: true } },
    })
    // Only public organization columns are selected.
    expect(Object.keys(args.select)).not.toContain('settings')
    expect(Object.keys(args.select)).not.toContain('users')
  })

  it('returns null when nothing matches', async () => {
    ;(prisma.organization.findFirst as any).mockResolvedValue(null)
    expect(await getPublicCareerPage('ghost')).toBeNull()
  })

  it('returns null (not a throw) when the table is missing', async () => {
    ;(prisma.organization.findFirst as any).mockRejectedValue(missingTable)
    expect(await getPublicCareerPage('acme-missing')).toBeNull()
  })

  it('never resolves the personal sentinel org', async () => {
    expect(await getPublicCareerPage('__personal_profiles__')).toBeNull()
    expect(prisma.organization.findFirst).not.toHaveBeenCalled()
  })
})

describe('getCareerJobs', () => {
  it('lists only published, non-deleted jobs of the org', async () => {
    ;(prisma.job.findMany as any).mockResolvedValue([{ id: 'j1' }])
    expect(await getCareerJobs('org-1')).toEqual([{ id: 'j1' }])
    expect((prisma.job.findMany as any).mock.calls[0][0].where).toEqual({
      orgId: 'org-1',
      status: 'PUBLISHED',
      deletedAt: null,
    })
  })
})

describe('getPublishedCareerSlug', () => {
  it('requires published + live org', async () => {
    ;(prisma.careerPage.findFirst as any).mockResolvedValue({ organization: { slug: 'acme' } })
    expect(await getPublishedCareerSlug('org-1')).toBe('acme')
    expect((prisma.careerPage.findFirst as any).mock.calls[0][0].where).toEqual({
      orgId: 'org-1',
      published: true,
      organization: { deletedAt: null },
    })
  })
  it('null when the table is missing', async () => {
    ;(prisma.careerPage.findFirst as any).mockRejectedValue(missingTable)
    expect(await getPublishedCareerSlug('org-1')).toBeNull()
  })
})

describe('getCareerSitemapEntries', () => {
  it('lists published pages of live orgs in all 5 locales', async () => {
    const updatedAt = new Date('2026-11-20')
    ;(prisma.careerPage.findMany as any).mockResolvedValue([
      { updatedAt, organization: { slug: 'acme' } },
    ])
    const entries = await getCareerSitemapEntries('https://jobsphere.eu')
    expect(entries.map((e) => e.url).sort()).toEqual(
      ['cs', 'de', 'en', 'pl', 'sk'].map((l) => `https://jobsphere.eu/${l}/careers/acme`),
    )
    expect((prisma.careerPage.findMany as any).mock.calls[0][0].where).toEqual({
      published: true,
      organization: { deletedAt: null },
    })
  })

  it('returns [] when the table is missing or the DB fails', async () => {
    ;(prisma.careerPage.findMany as any).mockRejectedValue(missingTable)
    expect(await getCareerSitemapEntries('https://x')).toEqual([])
    ;(prisma.careerPage.findMany as any).mockRejectedValue(new Error('connection refused'))
    expect(await getCareerSitemapEntries('https://x')).toEqual([])
  })
})
