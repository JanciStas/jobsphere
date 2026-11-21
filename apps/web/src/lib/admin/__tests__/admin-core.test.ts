import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import {
  parseAuditFilters,
  buildAuditWhere,
  formatAuditTime,
  diffJson,
  csvCell,
  auditRowsToCsv,
  AUDIT_CSV_HEADER,
} from '../audit-query'
import { deriveRole, safe } from '../overview'
import { ADMIN_NAV, isAdminNavActive } from '@/components/admin/admin-shell'

describe('parseAuditFilters', () => {
  it('parses valid filters and defaults page', () => {
    const f = parseAuditFilters({ action: 'BAN', from: '2026-01-01', user: 'a@b.sk' })
    expect(f).toMatchObject({ action: 'BAN', from: '2026-01-01', user: 'a@b.sk', page: 1 })
  })
  it('drops invalid values instead of throwing', () => {
    const f = parseAuditFilters({ action: "x'; DROP", from: 'yesterday', page: '-3' })
    expect(f.action).toBeUndefined()
    expect(f.from).toBeUndefined()
    expect(f.page).toBe(1)
  })
  it('treats empty strings as unset', () => {
    expect(parseAuditFilters({ action: '', to: '' })).toEqual({ page: 1 })
  })
})

describe('audit date filters use Slovak time (Europe/Bratislava)', () => {
  it('winter day = 23:00 UTC previous day .. 23:00 UTC (CET, +01:00)', async () => {
    const w = await buildAuditWhere({ from: '2026-11-21', to: '2026-11-21', page: 1 })
    expect(w.createdAt).toEqual({
      gte: new Date('2026-11-20T23:00:00.000Z'),
      lt: new Date('2026-11-21T23:00:00.000Z'),
    })
  })
  it('summer day = 22:00 UTC previous day (CEST, +02:00)', async () => {
    const w = await buildAuditWhere({ from: '2026-07-15', page: 1 })
    expect(w.createdAt).toEqual({ gte: new Date('2026-07-14T22:00:00.000Z') })
  })
  it('DST switch day (2026-03-29) is 23 hours long', async () => {
    const w = await buildAuditWhere({ from: '2026-03-29', to: '2026-03-29', page: 1 })
    expect(w.createdAt).toEqual({
      gte: new Date('2026-03-28T23:00:00.000Z'),
      lt: new Date('2026-03-29T22:00:00.000Z'),
    })
  })
  it('an entry at 00:30 Slovak time belongs to that Slovak day', () => {
    expect(formatAuditTime(new Date('2026-11-20T23:30:00.000Z'))).toBe('2026-11-21 00:30')
    expect(formatAuditTime(new Date('2026-07-14T22:05:00.000Z'))).toBe('2026-07-15 00:05')
  })
  it('impossible calendar dates are ignored', async () => {
    const w = await buildAuditWhere({ from: '2026-02-31', page: 1 })
    expect(w.createdAt).toBeUndefined()
  })
})

describe('diffJson', () => {
  it('reports added / removed / changed and ignores equal keys', () => {
    const d = diffJson({ a: 1, b: 2, same: 1 }, { a: 2, c: 3, same: 1 })
    expect(d).toEqual([
      { key: 'a', kind: 'changed', before: 1, after: 2 },
      { key: 'b', kind: 'removed', before: 2 },
      { key: 'c', kind: 'added', after: 3 },
    ])
  })
  it('redacts sensitive keys', () => {
    const d = diffJson({ passwordHash: 'abc' }, { passwordHash: 'def' })
    expect(d[0]).toMatchObject({ before: '[redacted]', after: '[redacted]' })
  })
  it('handles null on both sides', () => {
    expect(diffJson(null, null)).toEqual([])
  })
})

describe('csv', () => {
  it('escapes quotes/commas and neutralises formulas', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell(null)).toBe('')
  })
  it('has no userAgent column', () => {
    expect(AUDIT_CSV_HEADER).not.toContain('userAgent' as never)
    const csv = auditRowsToCsv([])
    expect(csv.trim()).toBe(AUDIT_CSV_HEADER.join(','))
  })
})

describe('deriveRole', () => {
  const base = { isGlobalAdmin: false, orgRoles: [], hasFreelancer: false, hasCandidate: false }
  it('maps identities', () => {
    expect(deriveRole({ ...base, isGlobalAdmin: true })).toBe('admin')
    expect(deriveRole({ ...base, orgRoles: ['AGENCY'] })).toBe('agency')
    expect(deriveRole({ ...base, hasFreelancer: true })).toBe('freelancer')
    expect(deriveRole({ ...base, orgRoles: ['RECRUITER'] })).toBe('employer')
    expect(deriveRole({ ...base, hasCandidate: true })).toBe('candidate')
    expect(deriveRole(base)).toBe('user')
  })
})

describe('safe', () => {
  it('returns null instead of throwing', async () => {
    expect(await safe('x', async () => Promise.reject(new Error('boom')))).toBeNull()
    expect(await safe('x', async () => 3)).toBe(3)
  })
})

describe('admin nav', () => {
  const find = (k: string) => ADMIN_NAV.find((i) => i.key === k)!
  it('overview is exact only', () => {
    expect(isAdminNavActive(find('overview'), '/sk/admin', 'sk')).toBe(true)
    expect(isAdminNavActive(find('overview'), '/sk/admin/users', 'sk')).toBe(false)
  })
  it('sub pages and billing alias', () => {
    expect(isAdminNavActive(find('users'), '/sk/admin/users/abc', 'sk')).toBe(true)
    expect(isAdminNavActive(find('billing'), '/en/admin/subscriptions', 'en')).toBe(true)
  })
})
