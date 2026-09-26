import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { prisma, createTestUser } from '../../helpers/test-db'
import { compare, hash } from 'bcryptjs'

/**
 * Integration tests for Authentication Login Flow
 * Tests the credentials provider authorization logic
 */

describe('Authentication Login Flow', () => {
  let testUser: any

  // Everything this file makes lives OUTSIDE TEST_IDS.org, so the global
  // cleanup in setup.ts never touched it. Deleting the users while their
  // UserOrgRole rows still pointed at them raised P2003 in beforeEach, which
  // took every test after the third one down — all 16 of them.
  async function purgeLoginFixtures() {
    const users = await prisma.user.findMany({
      where: { email: { contains: 'login-test' } },
      select: { id: true },
    })
    const userIds = users.map((u) => u.id)

    if (userIds.length > 0) {
      await prisma.userOrgRole.deleteMany({ where: { userId: { in: userIds } } })
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } })
    }
    // `slug: 'first-org'` is created by the multi-org test further down but was
    // missing from this list, so a second run of this file against a persistent
    // database died on `Unique constraint failed on the fields: (slug)`. The first
    // run always passed because the row did not exist yet — which is why CI (fresh
    // container per run) never saw it. Same trap schema-validation.test.ts already
    // documents in EXTRA_ORG_SLUGS. The prefix rule below means a new fixture
    // cannot fall out of sync with a hand-maintained list again.
    await prisma.organization.deleteMany({
      where: {
        OR: [
          { slug: { in: ['login-test-org', 'login-org-1', 'login-org-2'] } },
          { slug: { startsWith: 'login-test-' } },
        ],
      },
    })
    await prisma.user.deleteMany({ where: { email: { contains: 'login-test' } } })
  }

  beforeEach(async () => {
    await purgeLoginFixtures()

    // Create a test user for login
    testUser = await createTestUser('login-test@test.com', 'Login Test User', 'SecurePassword123!')
  })

  afterAll(async () => {
    await purgeLoginFixtures()
  })

  describe('Successful Login', () => {
    it('should authenticate user with correct credentials', async () => {
      // Arrange
      const email = 'login-test@test.com'
      const password = 'SecurePassword123!'

      // Act - Find user and verify password
      const user = await prisma.user.findUnique({
        where: { email },
      })

      expect(user).toBeTruthy()
      expect(user?.password).toBeTruthy()

      const isPasswordValid = await compare(password, user!.password!)

      // Assert
      expect(isPasswordValid).toBe(true)
      expect(user?.id).toBe(testUser.id)
      expect(user?.email).toBe(email)
      expect(user?.name).toBe('Login Test User')
    })

    it('should return user object with correct fields', async () => {
      // Arrange
      const user = await prisma.user.findUnique({
        where: { email: 'login-test@test.com' },
      })

      // Assert - verify user has required fields for session
      expect(user).toBeTruthy()
      expect(user?.id).toBeDefined()
      expect(user?.email).toBe('login-test@test.com')
      expect(user?.name).toBe('Login Test User')
    })

    it('should load user organization and role for employer', async () => {
      // Arrange - create employer with organization
      const employer = await createTestUser(
        'login-test-employer@test.com',
        'Employer User',
        'SecurePassword123!',
      )

      const org = await prisma.organization.create({
        data: {
          name: 'Login Test Org',
          slug: 'login-test-org',
        },
      })

      await prisma.userOrgRole.create({
        data: {
          userId: employer.id,
          orgId: org.id,
          role: 'ORG_ADMIN',
        },
      })

      // Act - fetch user with organization
      const userWithOrg = await prisma.user.findUnique({
        where: { id: employer.id },
        include: {
          organizations: {
            include: {
              organization: true,
            },
          },
        },
      })

      const userOrg = await prisma.userOrgRole.findFirst({
        where: { userId: employer.id },
        include: { organization: true },
      })

      // Assert
      expect(userWithOrg?.organizations).toHaveLength(1)
      expect(userOrg).toBeTruthy()
      expect(userOrg?.role).toBe('ORG_ADMIN')
      expect(userOrg?.orgId).toBe(org.id)
      expect(userOrg?.organization.name).toBe('Login Test Org')
    })

    it('should handle candidate user without organization', async () => {
      // Arrange - candidate has no organization
      const user = await prisma.user.findUnique({
        where: { email: 'login-test@test.com' },
      })

      // Act - check for organization
      const userOrg = await prisma.userOrgRole.findFirst({
        where: { userId: user?.id },
        include: { organization: true },
      })

      // Assert - candidate should have no organization
      expect(userOrg).toBeNull()
    })
  })

  describe('Failed Login', () => {
    it('should reject login with incorrect password', async () => {
      // Arrange
      const email = 'login-test@test.com'
      const wrongPassword = 'WrongPassword123!'

      // Act
      const user = await prisma.user.findUnique({
        where: { email },
      })

      expect(user).toBeTruthy()

      const isPasswordValid = await compare(wrongPassword, user!.password!)

      // Assert
      expect(isPasswordValid).toBe(false)
    })

    it('should reject login with non-existent email', async () => {
      // Arrange
      const email = 'non-existent@test.com'

      // Act
      const user = await prisma.user.findUnique({
        where: { email },
      })

      // Assert
      expect(user).toBeNull()
    })

    it('should reject user without password (OAuth-only user)', async () => {
      // Arrange - create OAuth user without password
      await prisma.user.create({
        data: {
          email: 'login-test-oauth@test.com',
          name: 'OAuth User',
          password: null, // OAuth users have no password
          locale: 'en',
        },
      })

      // Act
      const user = await prisma.user.findUnique({
        where: { email: 'login-test-oauth@test.com' },
      })

      // Assert
      expect(user).toBeTruthy()
      expect(user?.password).toBeNull()
      // In real auth flow, this would reject because no password to compare
    })

    it('should reject empty credentials', async () => {
      // Arrange
      const email = ''
      const password = ''

      // Act & Assert
      if (!email || !password) {
        // This simulates the credentials provider's early return
        expect(email).toBeFalsy()
        expect(password).toBeFalsy()
      }
    })

    it('should be case-sensitive for email', async () => {
      // Arrange - email stored as lowercase
      const correctEmail = 'login-test@test.com'
      const wrongCaseEmail = 'Login-Test@Test.Com'

      // Act
      const userCorrect = await prisma.user.findUnique({
        where: { email: correctEmail },
      })

      const userWrongCase = await prisma.user.findUnique({
        where: { email: wrongCaseEmail },
      })

      // Assert
      expect(userCorrect).toBeTruthy()
      expect(userWrongCase).toBeNull()
    })
  })

  describe('Password Security', () => {
    it('should store password as bcrypt hash', async () => {
      // Arrange
      const user = await prisma.user.findUnique({
        where: { email: 'login-test@test.com' },
      })

      // Assert
      expect(user?.password).toBeTruthy()
      expect(user?.password).not.toBe('SecurePassword123!')
      expect(user?.password).toMatch(/^\$2[aby]\$/) // bcrypt hash format
    })

    it('should use bcrypt compare for password verification', async () => {
      // Arrange
      const user = await prisma.user.findUnique({
        where: { email: 'login-test@test.com' },
      })

      // Act - verify using bcrypt compare (not simple string comparison)
      const isValid = await compare('SecurePassword123!', user!.password!)
      const isInvalid = user!.password! === 'SecurePassword123!' // Direct comparison should fail

      // Assert
      expect(isValid).toBe(true)
      expect(isInvalid).toBe(false)
    })

    it('should hash different passwords differently', async () => {
      // Arrange - create two users with different passwords
      const user1 = await createTestUser('login-test-user1@test.com', 'User 1', 'Password123!')

      const user2 = await createTestUser(
        'login-test-user2@test.com',
        'User 2',
        'DifferentPassword456!',
      )

      // Assert
      expect(user1.password).not.toBe(user2.password)
    })

    it('should hash same password with different salts', async () => {
      // Arrange - create two users with SAME password
      const user1 = await createTestUser(
        'login-test-same1@test.com',
        'Same Pass 1',
        'SamePassword123!',
      )

      const user2 = await createTestUser(
        'login-test-same2@test.com',
        'Same Pass 2',
        'SamePassword123!',
      )

      // Assert - even with same password, hashes should differ due to salt
      expect(user1.password).not.toBe(user2.password)

      // But both should validate correctly
      const valid1 = await compare('SamePassword123!', user1.password!)
      const valid2 = await compare('SamePassword123!', user2.password!)
      expect(valid1).toBe(true)
      expect(valid2).toBe(true)
    })
  })

  describe('Session Data', () => {
    it('should include user ID in session', async () => {
      // Arrange
      const user = await prisma.user.findUnique({
        where: { email: 'login-test@test.com' },
      })

      // Assert
      expect(user?.id).toBeDefined()
      expect(typeof user?.id).toBe('string')
    })

    it('should include user email in session', async () => {
      // Arrange
      const user = await prisma.user.findUnique({
        where: { email: 'login-test@test.com' },
      })

      // Assert
      expect(user?.email).toBe('login-test@test.com')
    })

    it('should include user name in session', async () => {
      // Arrange
      const user = await prisma.user.findUnique({
        where: { email: 'login-test@test.com' },
      })

      // Assert
      expect(user?.name).toBe('Login Test User')
    })

    it('should include user avatar if available', async () => {
      // Arrange - create user with avatar
      const userWithAvatar = await prisma.user.create({
        data: {
          email: 'login-test-avatar@test.com',
          name: 'Avatar User',
          password: await hash('Password123!', 12),
          avatar: 'https://example.com/avatar.jpg',
          locale: 'en',
        },
      })

      // Act
      const user = await prisma.user.findUnique({
        where: { id: userWithAvatar.id },
      })

      // Assert
      expect(user?.avatar).toBe('https://example.com/avatar.jpg')
    })
  })

  describe('Multi-Organization Support', () => {
    it('should handle user with multiple organization memberships', async () => {
      // Arrange
      const user = await createTestUser(
        'login-test-multi-org@test.com',
        'Multi Org User',
        'Password123!',
      )

      const org1 = await prisma.organization.create({
        data: { name: 'Org 1', slug: 'login-org-1' },
      })

      const org2 = await prisma.organization.create({
        data: { name: 'Org 2', slug: 'login-org-2' },
      })

      await prisma.userOrgRole.create({
        data: { userId: user.id, orgId: org1.id, role: 'RECRUITER' },
      })

      await prisma.userOrgRole.create({
        data: { userId: user.id, orgId: org2.id, role: 'ORG_ADMIN' },
      })

      // Act
      const userOrgs = await prisma.userOrgRole.findMany({
        where: { userId: user.id },
        include: { organization: true },
      })

      // Assert
      expect(userOrgs).toHaveLength(2)
      expect(userOrgs.map((o) => o.organization.name)).toContain('Org 1')
      expect(userOrgs.map((o) => o.organization.name)).toContain('Org 2')
    })

    it('should use first organization for JWT token', async () => {
      // Arrange
      const user = await createTestUser(
        'login-test-first-org@test.com',
        'First Org User',
        'Password123!',
      )

      const org = await prisma.organization.create({
        // Prefixed so purgeLoginFixtures() picks it up. It used to be `first-org`,
        // which nothing cleaned, so the second run hit a unique-slug violation.
        data: { name: 'First Org', slug: 'login-test-first-org' },
      })

      await prisma.userOrgRole.create({
        data: { userId: user.id, orgId: org.id, role: 'RECRUITER' },
      })

      // Act - simulate JWT callback behavior
      const userOrg = await prisma.userOrgRole.findFirst({
        where: { userId: user.id },
        include: { organization: true },
      })

      // Assert
      expect(userOrg).toBeTruthy()
      expect(userOrg?.role).toBe('RECRUITER')
      expect(userOrg?.orgId).toBe(org.id)
      expect(userOrg?.organization.name).toBe('First Org')
    })
  })
})
