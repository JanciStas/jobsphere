import { describe, it, expect } from 'vitest'
import {
  userMatchesPortal,
  portalHome,
  portalForPath,
  isPortal,
  isPublicPortal,
  matchingPortals,
  PUBLIC_PORTALS,
} from '../portal'

const none = { orgRoles: [], hasCandidate: false, hasFreelancer: false }

describe('userMatchesPortal', () => {
  it('candidate: plain account, or Candidate row', () => {
    expect(userMatchesPortal('candidate', none)).toBe(true)
    expect(userMatchesPortal('candidate', { ...none, hasCandidate: true })).toBe(true)
  })
  it('candidate: rejects pure org member / freelancer', () => {
    expect(userMatchesPortal('candidate', { ...none, orgRoles: ['ORG_ADMIN'] })).toBe(false)
    expect(userMatchesPortal('candidate', { ...none, hasFreelancer: true })).toBe(false)
  })
  it('candidate: dual-role with Candidate row is allowed', () => {
    expect(
      userMatchesPortal('candidate', {
        orgRoles: ['ORG_ADMIN'],
        hasCandidate: true,
        hasFreelancer: false,
      }),
    ).toBe(true)
  })
  it('agency requires AGENCY role', () => {
    expect(userMatchesPortal('agency', { ...none, orgRoles: ['AGENCY'] })).toBe(true)
    expect(userMatchesPortal('agency', { ...none, orgRoles: ['ORG_ADMIN'] })).toBe(false)
    expect(userMatchesPortal('agency', none)).toBe(false)
  })
  it('freelancer requires FreelancerProfile', () => {
    expect(userMatchesPortal('freelancer', { ...none, hasFreelancer: true })).toBe(true)
    expect(userMatchesPortal('freelancer', none)).toBe(false)
  })
  it('employer requires an employer-type role (not AGENCY)', () => {
    for (const r of ['ORG_ADMIN', 'RECRUITER', 'HIRING_MANAGER']) {
      expect(userMatchesPortal('employer', { ...none, orgRoles: [r] })).toBe(true)
    }
    expect(userMatchesPortal('employer', { ...none, orgRoles: ['AGENCY'] })).toBe(false)
    expect(userMatchesPortal('employer', none)).toBe(false)
  })
})

describe('admin portal', () => {
  it('requires isGlobalAdmin', () => {
    expect(userMatchesPortal('admin', { ...none, isGlobalAdmin: true })).toBe(true)
    expect(userMatchesPortal('admin', none)).toBe(false)
    expect(userMatchesPortal('admin', { ...none, isGlobalAdmin: false })).toBe(false)
    expect(userMatchesPortal('admin', { ...none, orgRoles: ['ORG_ADMIN'] })).toBe(false)
  })
  it('is never suggested publicly', () => {
    expect(matchingPortals({ ...none, isGlobalAdmin: true })).not.toContain('admin')
    expect(PUBLIC_PORTALS).not.toContain('admin')
    expect(isPublicPortal('admin')).toBe(false)
    expect(isPublicPortal('agency')).toBe(true)
  })
  it('home and path mapping', () => {
    expect(portalHome('admin', 'sk')).toBe('/sk/admin')
    expect(portalForPath('/admin')).toBe('admin')
    expect(portalForPath('/admin/users')).toBe('admin')
    expect(portalForPath('/administrator')).toBeNull()
  })
})

describe('portal helpers', () => {
  it('isPortal', () => {
    expect(isPortal('agency')).toBe(true)
    expect(isPortal('admin')).toBe(true)
    expect(isPortal('superuser')).toBe(false)
    expect(isPortal(undefined)).toBe(false)
  })
  it('portalHome', () => {
    expect(portalHome('candidate', 'sk')).toBe('/sk/dashboard')
    expect(portalHome('agency', 'en')).toBe('/en/agency/dashboard')
    expect(portalHome('freelancer', 'de')).toBe('/de/freelancer/dashboard')
    expect(portalHome('employer', 'cs')).toBe('/cs/employer')
  })
  it('portalForPath', () => {
    expect(portalForPath('/agency/dashboard')).toBe('agency')
    expect(portalForPath('/freelancer/dashboard')).toBe('freelancer')
    expect(portalForPath('/freelancer/proposals')).toBe('freelancer')
    expect(portalForPath('/freelancer/portfolio')).toBe('freelancer')
    expect(portalForPath('/freelancer')).toBe('freelancer')
    expect(portalForPath('/freelancers')).toBeNull()
    expect(portalForPath('/freelancer-profile/x')).toBeNull()
    expect(portalForPath('/employer/jobs')).toBe('employer')
    expect(portalForPath('/dashboard')).toBe('candidate')
    expect(portalForPath('/settings')).toBeNull()
  })
})

describe('matchingPortals', () => {
  it('returns the portals an employer account may use', async () => {
    const { matchingPortals } = await import('../portal')
    expect(
      matchingPortals({ orgRoles: ['ORG_ADMIN'], hasCandidate: false, hasFreelancer: false }),
    ).toEqual(['employer'])
  })

  it('returns every portal of a dual-role account', async () => {
    const { matchingPortals } = await import('../portal')
    expect(
      matchingPortals({ orgRoles: ['AGENCY'], hasCandidate: true, hasFreelancer: true }),
    ).toEqual(['candidate', 'agency', 'freelancer'])
  })
})
