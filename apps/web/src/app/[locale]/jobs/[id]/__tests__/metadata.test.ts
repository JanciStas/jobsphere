import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUnique = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { job: { findUnique: (...args: unknown[]) => findUnique(...args) } },
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getFormatter: async () => ({}),
}))
vi.mock('next/navigation', () => ({ notFound: vi.fn() }))
vi.mock('@/components/job/view-tracker', () => ({ ViewTracker: () => null }))
vi.mock('@/components/job/save-job-button', () => ({ SaveJobButton: () => null }))
vi.mock('@/components/job/share-job-button', () => ({ ShareJobButton: () => null }))

import { generateMetadata } from '../page'

describe('jobs/[id] generateMetadata', () => {
  beforeEach(() => {
    findUnique.mockReset()
  })

  it('marks an unknown/unpublished job as noindex (page streams as HTTP 200)', async () => {
    findUnique.mockResolvedValue(null)
    const meta = await generateMetadata({ params: { id: 'nonexistent', locale: 'sk' } })
    expect(meta.robots).toEqual({ index: false, follow: false })
  })

  it('marks the page noindex when the DB lookup throws', async () => {
    findUnique.mockRejectedValue(new Error('db down'))
    const meta = await generateMetadata({ params: { id: 'x', locale: 'sk' } })
    expect(meta.robots).toEqual({ index: false, follow: false })
  })

  it('does not set noindex for a real published job', async () => {
    findUnique.mockResolvedValue({
      title: 'Dev',
      description: 'd',
      city: 'Bratislava',
      region: 'BA',
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: 'EUR',
      employmentType: 'FULL_TIME',
      metaTitle: null,
      metaDescription: null,
      organization: { name: 'Acme' },
    })
    const meta = await generateMetadata({ params: { id: 'real', locale: 'sk' } })
    expect(meta.robots).toBeUndefined()
  })
})
