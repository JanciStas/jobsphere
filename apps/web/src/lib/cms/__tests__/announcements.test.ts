/**
 * Site announcements: pure selection, validation, Slovak-time helpers and the
 * public loader's behavior when the CMS table does not exist yet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
}))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { siteAnnouncement: { findMany: vi.fn() } },
}))

import { prisma } from '@/lib/prisma'
import {
  announcementCreateSchema,
  announcementStatus,
  bratislavaLocalToDate,
  dateToBratislavaLocal,
  getActiveAnnouncements,
  selectAnnouncements,
  type AnnouncementRow,
} from '../announcements'
import {
  visibleAnnouncements,
  viewerFromSession,
} from '@/components/layout/announcement-bar-client'

const findMany = (prisma as any).siteAnnouncement.findMany as ReturnType<typeof vi.fn>

const NOW = new Date('2026-11-24T12:00:00.000Z')

const row = (over: Partial<AnnouncementRow> = {}): AnnouncementRow => ({
  id: 'a1',
  message: { sk: 'Ahoj', en: 'Hello' },
  linkUrl: null,
  linkLabel: {},
  variant: 'info',
  audience: 'all',
  startsAt: null,
  endsAt: null,
  active: true,
  dismissible: true,
  updatedAt: new Date('2026-11-20T10:00:00.000Z'),
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('selectAnnouncements — time window', () => {
  it('keeps open-ended rows and rows whose window contains now', () => {
    const rows = [
      row({ id: 'open' }),
      row({ id: 'inside', startsAt: '2026-11-24T11:00:00Z', endsAt: '2026-11-24T13:00:00Z' }),
    ]
    expect(selectAnnouncements(rows, { now: NOW, locale: 'sk' }).map((a) => a.id)).toEqual([
      'open',
      'inside',
    ])
  })

  it('drops scheduled, expired and inactive rows (endsAt is exclusive)', () => {
    const rows = [
      row({ id: 'future', startsAt: new Date('2026-11-24T12:00:01Z') }),
      row({ id: 'past', endsAt: new Date('2026-11-24T11:59:59Z') }),
      row({ id: 'endsNow', endsAt: NOW }),
      row({ id: 'off', active: false }),
      row({ id: 'startsNow', startsAt: NOW }),
    ]
    expect(selectAnnouncements(rows, { now: NOW, locale: 'sk' }).map((a) => a.id)).toEqual([
      'startsNow',
    ])
  })
})

describe('selectAnnouncements — audience', () => {
  const rows = [
    row({ id: 'all', audience: 'all' }),
    row({ id: 'cand', audience: 'candidates' }),
    row({ id: 'emp', audience: 'employers' }),
    row({ id: 'guest', audience: 'guests' }),
    row({ id: 'bogus', audience: 'admins' }),
  ]
  const ids = (audience?: 'guest' | 'candidate' | 'employer') =>
    selectAnnouncements(rows, { now: NOW, locale: 'sk', audience }).map((a) => a.id)

  it('without a viewer applies no audience filter but drops unknown audiences', () => {
    expect(ids()).toEqual(['all', 'cand', 'emp', 'guest'])
  })
  it('filters per viewer', () => {
    expect(ids('guest')).toEqual(['all', 'guest'])
    expect(ids('candidate')).toEqual(['all', 'cand'])
    expect(ids('employer')).toEqual(['all', 'emp'])
  })
})

describe('selectAnnouncements — locale', () => {
  const pick = (message: unknown, locale: string) =>
    selectAnnouncements([row({ message })], { now: NOW, locale })[0]?.message

  it('uses the requested locale, then sk, then en, then the first non-empty', () => {
    expect(pick({ sk: 'SK', en: 'EN', de: 'DE' }, 'de')).toBe('DE')
    expect(pick({ sk: 'SK', en: 'EN' }, 'pl')).toBe('SK')
    expect(pick({ sk: '  ', en: 'EN', cs: 'CS' }, 'pl')).toBe('EN')
    expect(pick({ cs: 'CS' }, 'de')).toBe('CS')
  })

  it('drops rows without any text', () => {
    expect(pick({}, 'sk')).toBeUndefined()
    expect(pick({ sk: '', en: '   ' }, 'sk')).toBeUndefined()
    expect(pick(null, 'sk')).toBeUndefined()
    expect(pick('just a string', 'sk')).toBeUndefined()
  })

  it('resolves the link label too and ignores unsafe stored links', () => {
    const [a] = selectAnnouncements(
      [row({ linkUrl: '/sk/jobs', linkLabel: { sk: 'Ponuky', en: 'Jobs' } })],
      { now: NOW, locale: 'en' },
    )
    expect(a).toMatchObject({ linkUrl: '/sk/jobs', linkLabel: 'Jobs' })
    const [b] = selectAnnouncements([row({ linkUrl: 'javascript:alert(1)' })], {
      now: NOW,
      locale: 'sk',
    })
    expect(b).toMatchObject({ linkUrl: null, linkLabel: null })
  })

  it('exposes a version that changes with updatedAt', () => {
    const [a] = selectAnnouncements([row()], { now: NOW, locale: 'sk' })
    expect(a.version).toBe('2026-11-20T10:00:00.000Z')
  })
})

describe('announcementStatus', () => {
  it('maps to active / scheduled / expired / inactive', () => {
    expect(announcementStatus(row(), NOW)).toBe('active')
    expect(announcementStatus(row({ startsAt: '2026-12-01T00:00:00Z' }), NOW)).toBe('scheduled')
    expect(announcementStatus(row({ endsAt: '2026-11-01T00:00:00Z' }), NOW)).toBe('expired')
    expect(announcementStatus(row({ active: false }), NOW)).toBe('inactive')
  })
})

describe('Slovak time helpers', () => {
  it('interprets datetime-local values in Europe/Bratislava (winter and summer time)', () => {
    expect(bratislavaLocalToDate('2026-01-15T10:00')?.toISOString()).toBe(
      '2026-01-15T09:00:00.000Z',
    )
    expect(bratislavaLocalToDate('2026-07-15T10:00')?.toISOString()).toBe(
      '2026-07-15T08:00:00.000Z',
    )
    expect(bratislavaLocalToDate('2026-02-30T10:00')).toBeNull()
    expect(bratislavaLocalToDate('nonsense')).toBeNull()
  })

  it('round-trips back to a datetime-local value', () => {
    expect(dateToBratislavaLocal('2026-07-15T08:00:00.000Z')).toBe('2026-07-15T10:00')
    expect(dateToBratislavaLocal(new Date('2026-01-15T09:30:00.000Z'))).toBe('2026-01-15T10:30')
  })
})

describe('announcementCreateSchema', () => {
  it('requires the Slovak message and drops empty translations', () => {
    const ok = announcementCreateSchema.safeParse({ message: { sk: ' Ahoj ', en: '' } })
    expect(ok.success).toBe(true)
    if (ok.success) {
      expect(ok.data.message).toEqual({ sk: 'Ahoj' })
      expect(ok.data).toMatchObject({ variant: 'info', audience: 'all', active: false })
    }
    expect(announcementCreateSchema.safeParse({ message: { en: 'Hello' } }).success).toBe(false)
  })

  it('rejects over-long text, unknown locales and unsafe links', () => {
    expect(announcementCreateSchema.safeParse({ message: { sk: 'x'.repeat(301) } }).success).toBe(
      false,
    )
    expect(announcementCreateSchema.safeParse({ message: { sk: 'a', fr: 'b' } }).success).toBe(
      false,
    )
    expect(
      announcementCreateSchema.safeParse({
        message: { sk: 'a' },
        linkUrl: '/x',
        linkLabel: { sk: 'y'.repeat(61) },
      }).success,
    ).toBe(false)
    expect(
      announcementCreateSchema.safeParse({ message: { sk: 'a' }, linkUrl: 'javascript:alert(1)' })
        .success,
    ).toBe(false)
    expect(
      announcementCreateSchema.safeParse({ message: { sk: 'a' }, linkUrl: '//evil.example' })
        .success,
    ).toBe(false)
  })

  it('requires endsAt after startsAt', () => {
    const bad = announcementCreateSchema.safeParse({
      message: { sk: 'a' },
      startsAt: '2026-12-01T10:00',
      endsAt: '2026-12-01T10:00',
    })
    expect(bad.success).toBe(false)
    const good = announcementCreateSchema.safeParse({
      message: { sk: 'a' },
      startsAt: '2026-12-01T10:00',
      endsAt: '',
    })
    expect(good.success).toBe(true)
    if (good.success) {
      expect(good.data.startsAt?.toISOString()).toBe('2026-12-01T09:00:00.000Z')
      expect(good.data.endsAt).toBeNull()
    }
  })
})

describe('public loader', () => {
  it('returns [] when the table does not exist yet', async () => {
    findMany.mockRejectedValue(
      Object.assign(new Error('The table `public.SiteAnnouncement` does not exist'), {
        code: 'P2021',
      }),
    )
    await expect(getActiveAnnouncements('sk', NOW)).resolves.toEqual([])
  })

  it('returns [] on any other DB error too', async () => {
    findMany.mockRejectedValue(new Error('connection refused'))
    await expect(getActiveAnnouncements('sk', NOW)).resolves.toEqual([])
  })

  it('reads only active rows and applies the time window and locale', async () => {
    findMany.mockResolvedValue([
      { ...row({ id: 'now' }), startsAt: null, endsAt: null, updatedAt: new Date(NOW) },
      {
        ...row({ id: 'later' }),
        startsAt: new Date('2026-12-01T00:00:00Z'),
        endsAt: null,
        updatedAt: new Date(NOW),
      },
    ])
    const result = await getActiveAnnouncements('en', NOW)
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }))
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'now', message: 'Hello' })
  })
})

describe('announcement bar client logic', () => {
  const items = selectAnnouncements(
    [
      row({ id: 'all-fixed', dismissible: false }),
      row({ id: 'all-dismissible' }),
      row({ id: 'employers', audience: 'employers', dismissible: false }),
      row({ id: 'guests', audience: 'guests', dismissible: false }),
    ],
    { now: NOW, locale: 'sk' },
  )

  it('derives the viewer like the header does', () => {
    expect(viewerFromSession(null)).toBe('guest')
    expect(viewerFromSession({ role: 'AGENCY' })).toBe('employer')
    expect(viewerFromSession({ role: 'RECRUITER', orgId: 'o1' })).toBe('employer')
    expect(viewerFromSession({})).toBe('candidate')
  })

  it('before mount shows only items that need neither session nor storage', () => {
    const v = visibleAnnouncements(items, { now: null, viewer: null, dismissed: new Set() })
    expect(v.map((a) => a.id)).toEqual(['all-fixed'])
  })

  it('after mount filters by audience, hides dismissed items and caps at 2', () => {
    const dismissed = new Set([
      `jobsphere:announcement-dismissed:all-dismissible:${items[1].version}`,
    ])
    const v = visibleAnnouncements(items, { now: NOW.getTime(), viewer: 'employer', dismissed })
    expect(v.map((a) => a.id)).toEqual(['all-fixed', 'employers'])
    const guest = visibleAnnouncements(items, {
      now: NOW.getTime(),
      viewer: 'guest',
      dismissed: new Set(),
    })
    expect(guest.map((a) => a.id)).toEqual(['all-fixed', 'all-dismissible'])
  })

  it('hides items that expired after the page was cached', () => {
    const [expiring] = selectAnnouncements([row({ endsAt: '2026-11-24T12:00:30Z' })], {
      now: NOW,
      locale: 'sk',
    })
    const later = NOW.getTime() + 60_000
    expect(
      visibleAnnouncements([expiring], { now: later, viewer: 'guest', dismissed: new Set() }),
    ).toEqual([])
  })
})
