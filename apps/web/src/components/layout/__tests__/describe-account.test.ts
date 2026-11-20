import { describe, it, expect } from 'vitest'
import { describeAccount } from '../header'

describe('describeAccount', () => {
  it('gives a super admin the admin area', () => {
    const a = describeAccount({ isGlobalAdmin: true, orgId: 'o1' }, 'sk')
    expect(a.role).toBe('admin')
    expect(a.dashboardHref).toBe('/sk/admin')
  })

  it('maps an AGENCY member to the agency dashboard', () => {
    const a = describeAccount({ role: 'AGENCY', orgId: 'o1' }, 'sk')
    expect(a.role).toBe('agency')
    expect(a.dashboardHref).toBe('/sk/agency/dashboard')
  })

  it('maps other org members to the employer area', () => {
    const a = describeAccount({ role: 'ORG_ADMIN', orgId: 'o1' }, 'en')
    expect(a.role).toBe('employer')
    expect(a.settingsHref).toBe('/en/employer/settings')
  })

  it('maps a freelancer without org to the freelancer dashboard', () => {
    expect(describeAccount({ isFreelancer: true }, 'sk').dashboardHref).toBe(
      '/sk/freelancer/dashboard',
    )
  })

  it('defaults to the candidate dashboard', () => {
    expect(describeAccount({}, 'sk').role).toBe('candidate')
    expect(describeAccount(undefined, 'sk').dashboardHref).toBe('/sk/dashboard')
  })
})
