import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  hasFeature,
  canCreateJob,
  getFeatureLimit,
  canAddCandidate,
  canAddTeamMember,
  getCurrentPlan,
  checkEntitlement,
} from '../entitlements'
import { createMockEntitlement } from '../../../tests/helpers/factories'

vi.mock('@/lib/db', () => ({
  prisma: {
    entitlement: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    job: {
      count: vi.fn(),
    },
    application: {
      count: vi.fn(),
    },
    userOrgRole: {
      count: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db'

describe('Entitlements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('hasFeature', () => {
    it('should return true when limitInt > 0', async () => {
      const mockEntitlement = createMockEntitlement({
        featureKey: 'AI_MATCHING',
        limitInt: 1,
      })

      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(mockEntitlement as any)

      const result = await hasFeature('org-123', 'AI_MATCHING')

      expect(result).toBe(true)
      expect(prisma.entitlement.findUnique).toHaveBeenCalledWith({
        where: {
          orgId_featureKey: {
            orgId: 'org-123',
            featureKey: 'AI_MATCHING',
          },
        },
      })
    })

    it('should return false when limitInt is 0', async () => {
      const mockEntitlement = createMockEntitlement({ limitInt: 0 })
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(mockEntitlement as any)

      const result = await hasFeature('org-123', 'AI_MATCHING')

      expect(result).toBe(false)
    })

    it('should return false when entitlement not found', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(null)

      const result = await hasFeature('org-123', 'AI_MATCHING')

      expect(result).toBe(false)
    })
  })

  describe('canCreateJob', () => {
    it('should return true when under limit', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(
        createMockEntitlement({ featureKey: 'MAX_JOBS', limitInt: 5 }) as any,
      )
      vi.mocked(prisma.job.count).mockResolvedValue(3 as any)

      const result = await canCreateJob('org-123')

      expect(result).toBe(true)
      expect(prisma.job.count).toHaveBeenCalledWith({
        where: { orgId: 'org-123', status: 'PUBLISHED' },
      })
    })

    it('should return false when at limit', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(
        createMockEntitlement({ featureKey: 'MAX_JOBS', limitInt: 5 }) as any,
      )
      vi.mocked(prisma.job.count).mockResolvedValue(5 as any)

      const result = await canCreateJob('org-123')

      expect(result).toBe(false)
    })

    it('should return true for unlimited (null)', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(
        createMockEntitlement({ featureKey: 'MAX_JOBS', limitInt: null }) as any,
      )

      const result = await canCreateJob('org-123')

      expect(result).toBe(true)
      expect(prisma.job.count).not.toHaveBeenCalled()
    })
  })

  describe('getFeatureLimit', () => {
    it('should return limitInt when entitlement exists', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(
        createMockEntitlement({ limitInt: 10 }) as any,
      )

      const result = await getFeatureLimit('org-123', 'MAX_JOBS')

      expect(result).toBe(10)
    })

    it('should return the STARTER default when entitlement not found', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(null)

      const result = await getFeatureLimit('org-123', 'MAX_JOBS')

      // Missing record => STARTER default (5), not 0 (would lock out free orgs)
      // and not null/unlimited (would leak revenue).
      expect(result).toBe(5)
    })

    it('should return null for unlimited', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(
        createMockEntitlement({ limitInt: null }) as any,
      )

      const result = await getFeatureLimit('org-123', 'MAX_JOBS')

      expect(result).toBe(null)
    })
  })

  describe('canAddCandidate', () => {
    it('should return true when under limit', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(
        createMockEntitlement({ featureKey: 'MAX_CANDIDATES', limitInt: 100 }) as any,
      )
      vi.mocked(prisma.application.count).mockResolvedValue(50 as any)

      const result = await canAddCandidate('org-123')

      expect(result).toBe(true)
      expect(prisma.application.count).toHaveBeenCalledWith({
        where: { orgId: 'org-123' },
      })
    })

    it('should return false when at limit', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(
        createMockEntitlement({ featureKey: 'MAX_CANDIDATES', limitInt: 100 }) as any,
      )
      vi.mocked(prisma.application.count).mockResolvedValue(100 as any)

      const result = await canAddCandidate('org-123')

      expect(result).toBe(false)
    })
  })

  describe('canAddTeamMember', () => {
    it('should return true when under limit', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(
        createMockEntitlement({ featureKey: 'MAX_TEAM_MEMBERS', limitInt: 10 }) as any,
      )
      vi.mocked(prisma.userOrgRole.count).mockResolvedValue(5 as any)

      const result = await canAddTeamMember('org-123')

      expect(result).toBe(true)
      expect(prisma.userOrgRole.count).toHaveBeenCalledWith({
        where: { orgId: 'org-123' },
      })
    })
  })

  describe('getCurrentPlan', () => {
    it('should return plan from active subscription', async () => {
      vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
        id: 'sub-123',
        orgId: 'org-123',
        status: 'active',
        currentPeriodEnd: new Date(),
        metadata: {},
        product: {
          name: 'Professional Plan',
          plans: [
            {
              key: 'PROFESSIONAL',
            },
          ],
        },
      } as any)

      const result = await getCurrentPlan('org-123')

      expect(result).toBe('PROFESSIONAL')
    })

    it('ignores subscriptions whose period ended (manual plans must expire)', async () => {
      vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null)

      await getCurrentPlan('org-123')

      const where = vi.mocked(prisma.subscription.findFirst).mock.calls.at(-1)?.[0]?.where as any
      const cutoff: Date = where.currentPeriodEnd.gt
      expect(cutoff).toBeInstanceOf(Date)
      // Grace window is a few days at most, never in the future.
      expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now())
      expect(cutoff.getTime()).toBeGreaterThan(Date.now() - 7 * 24 * 60 * 60 * 1000)
    })

    it('should return STARTER when no subscription', async () => {
      vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null)

      const result = await getCurrentPlan('org-123')

      expect(result).toBe('STARTER')
    })
  })

  // LOGIC-003: missing record => STARTER default; limitInt === null => unlimited.
  describe('checkEntitlement — LOGIC-003 gate semantics', () => {
    it('missing record falls back to STARTER limited (deny a STARTER-disabled feature)', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(null)

      // AI_MATCHING is disabled on STARTER => missing record must DENY,
      // NOT grant unlimited free access (the previous revenue-leak bug).
      const result = await checkEntitlement('org-123', 'AI_MATCHING')

      expect(result).toBe(false)
    })

    it('missing record allows a feature that STARTER includes (MAX_JOBS)', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(null)

      // STARTER allows MAX_JOBS (limit 5) => missing record allows (capacity is
      // enforced separately by canCreateJob's count check).
      const result = await checkEntitlement('org-123', 'MAX_JOBS')

      expect(result).toBe(true)
    })

    it('limitInt === null is treated as UNLIMITED (ENTERPRISE not blocked)', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(
        createMockEntitlement({
          featureKey: 'MAX_JOBS',
          limitInt: null,
          remainingInt: null,
        }) as any,
      )

      // The previous bug coerced null -> 0 and returned false, blocking the most
      // expensive customer. null must mean unlimited => allow.
      const result = await checkEntitlement('org-123', 'MAX_JOBS')

      expect(result).toBe(true)
    })

    it('limitInt === 0 means the feature is disabled (deny)', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(
        createMockEntitlement({ featureKey: 'AI_MATCHING', limitInt: 0, remainingInt: 0 }) as any,
      )

      const result = await checkEntitlement('org-123', 'AI_MATCHING')

      expect(result).toBe(false)
    })

    it('positive limit denies when no remaining capacity', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(
        createMockEntitlement({ featureKey: 'MAX_JOBS', limitInt: 5, remainingInt: 0 }) as any,
      )

      const result = await checkEntitlement('org-123', 'MAX_JOBS')

      expect(result).toBe(false)
    })

    it('positive limit allows while remaining capacity exists', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(
        createMockEntitlement({ featureKey: 'MAX_JOBS', limitInt: 5, remainingInt: 3 }) as any,
      )

      const result = await checkEntitlement('org-123', 'MAX_JOBS')

      expect(result).toBe(true)
    })
  })

  describe('hasFeature — LOGIC-003 semantics', () => {
    it('missing record uses STARTER default (enabled feature)', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(null)

      // MAX_JOBS has a positive STARTER limit => enabled.
      expect(await hasFeature('org-123', 'MAX_JOBS')).toBe(true)
      // AI_MATCHING is 0 on STARTER => disabled.
      expect(await hasFeature('org-123', 'AI_MATCHING')).toBe(false)
    })

    it('limitInt === null means unlimited => enabled', async () => {
      vi.mocked(prisma.entitlement.findUnique).mockResolvedValue(
        createMockEntitlement({ featureKey: 'AI_MATCHING', limitInt: null }) as any,
      )

      expect(await hasFeature('org-123', 'AI_MATCHING')).toBe(true)
    })
  })
})
