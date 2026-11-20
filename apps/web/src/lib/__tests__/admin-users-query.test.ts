import { describe, it, expect } from 'vitest'
import { buildOrderBy, buildWhere, parseListQuery } from '@/lib/admin-users/list-query'
import { deriveRoles, deriveStatus } from '@/lib/admin-users/roles'

const NOW = new Date('2026-11-20T10:00:00.000Z')

function q(raw: Record<string, string>) {
  const parsed = parseListQuery(raw)
  if (!parsed.success) throw new Error('parse failed')
  return parsed.data
}

describe('parseListQuery', () => {
  it('applies defaults and ignores empty strings', () => {
    expect(q({ search: '', role: '' })).toMatchObject({
      sort: 'createdAt',
      order: 'desc',
      page: 1,
      limit: 20,
    })
  })

  it('rejects unknown roles, statuses and sort keys', () => {
    expect(parseListQuery({ role: 'ROOT' }).success).toBe(false)
    expect(parseListQuery({ status: 'weird' }).success).toBe(false)
    expect(parseListQuery({ sort: 'password' }).success).toBe(false)
    expect(parseListQuery({ limit: '1000' }).success).toBe(false)
  })
})

describe('buildWhere', () => {
  it('always excludes soft-deleted accounts', () => {
    expect(buildWhere(q({}), NOW)).toEqual({ AND: [{ deletedAt: null }] })
  })

  it('searches name and e-mail case-insensitively', () => {
    const where = buildWhere(q({ search: 'jan' }), NOW)
    expect(where.AND).toContainEqual({
      OR: [
        { email: { contains: 'jan', mode: 'insensitive' } },
        { name: { contains: 'jan', mode: 'insensitive' } },
      ],
    })
  })

  it('maps every role filter', () => {
    expect(buildWhere(q({ role: 'ADMIN' }), NOW).AND).toContainEqual({ isGlobalAdmin: true })
    expect(buildWhere(q({ role: 'CANDIDATE' }), NOW).AND).toContainEqual({
      candidates: { some: {} },
    })
    expect(buildWhere(q({ role: 'FREELANCER' }), NOW).AND).toContainEqual({
      freelancerProfile: { isNot: null },
    })
    expect(buildWhere(q({ role: 'AGENCY' }), NOW).AND).toContainEqual({
      organizations: { some: { role: 'AGENCY', deletedAt: null } },
    })
    const employer = JSON.stringify(buildWhere(q({ role: 'EMPLOYER' }), NOW))
    expect(employer).toContain('ORG_ADMIN')
    expect(employer).not.toContain('"AGENCY"')
  })

  it('separates suspended (2099 sentinel) from temporarily locked', () => {
    const suspended = JSON.stringify(buildWhere(q({ status: 'suspended' }), NOW))
    const locked = JSON.stringify(buildWhere(q({ status: 'locked' }), NOW))
    expect(suspended).toContain('"gte"')
    expect(locked).toContain('"gt"')
    expect(locked).toContain('"lt"')
    expect(buildWhere(q({ status: 'unverified' }), NOW).AND).toContainEqual({
      emailVerified: null,
    })
  })
})

describe('buildOrderBy', () => {
  it('puts never-logged-in accounts last when sorting by last login', () => {
    expect(buildOrderBy(q({ sort: 'lastLoginAt', order: 'desc' }))[0]).toEqual({
      lastLoginAt: { sort: 'desc', nulls: 'last' },
    })
  })
  it('sorts by registration date by default', () => {
    expect(buildOrderBy(q({}))).toEqual([{ createdAt: 'desc' }])
  })
})

describe('deriveRoles / deriveStatus', () => {
  it('derives combined roles', () => {
    expect(
      deriveRoles({
        isGlobalAdmin: true,
        orgRoles: ['RECRUITER', 'AGENCY'],
        hasCandidate: true,
        hasFreelancer: true,
      }),
    ).toEqual(['ADMIN', 'EMPLOYER', 'AGENCY', 'CANDIDATE', 'FREELANCER'])
    expect(
      deriveRoles({
        isGlobalAdmin: false,
        orgRoles: [],
        hasCandidate: false,
        hasFreelancer: false,
      }),
    ).toEqual([])
  })

  it('derives status from lockedUntil', () => {
    expect(deriveStatus(null, NOW)).toBe('ACTIVE')
    expect(deriveStatus(new Date('2026-11-19T00:00:00Z'), NOW)).toBe('ACTIVE')
    expect(deriveStatus(new Date('2026-11-20T10:15:00Z'), NOW)).toBe('LOCKED')
    expect(deriveStatus(new Date('2099-01-01T00:00:00Z'), NOW)).toBe('SUSPENDED')
  })
})
