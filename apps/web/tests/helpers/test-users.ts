/**
 * Test user helpers and factories for Playwright E2E tests
 *
 * This module provides:
 * - Test user data for each role (CANDIDATE, RECRUITER, ORG_ADMIN, HIRING_MANAGER)
 * - Factory functions to create test users with proper role assignments
 * - Organization seeding data for multi-tenant testing
 */

import { hash } from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

// Test organization data
export const TEST_ORG = {
  id: 'test-org-playwright',
  name: 'Test Org Inc',
  slug: 'test-org-inc',
  description: 'Test organization for E2E tests',
  industry: 'Technology',
  size: '50-200',
  website: 'https://testorg.example.com',
} as const

// Default test password (hashed version will be stored in DB)
export const TEST_PASSWORD = 'TestPassword123!'

// Test users for each role
export const TEST_USERS = {
  candidate: {
    id: 'test-candidate-user',
    email: 'candidate@test.jobsphere.com',
    password: TEST_PASSWORD,
    name: 'Test Candidate',
    role: null, // Candidates don't have org roles
  },
  recruiter: {
    id: 'test-recruiter-user',
    email: 'recruiter@test.jobsphere.com',
    password: TEST_PASSWORD,
    name: 'Test Recruiter',
    role: 'RECRUITER',
    orgId: TEST_ORG.id,
  },
  orgAdmin: {
    id: 'test-admin-user',
    email: 'admin@test.jobsphere.com',
    password: TEST_PASSWORD,
    name: 'Test Admin',
    role: 'ORG_ADMIN',
    orgId: TEST_ORG.id,
  },
  hiringManager: {
    id: 'test-hiring-manager-user',
    email: 'hiring-manager@test.jobsphere.com',
    password: TEST_PASSWORD,
    name: 'Test Hiring Manager',
    role: 'HIRING_MANAGER',
    orgId: TEST_ORG.id,
  },
  agency: {
    id: 'test-agency-user',
    email: 'agency@test.jobsphere.com',
    password: TEST_PASSWORD,
    name: 'Test Agency',
    role: 'AGENCY',
    orgId: TEST_ORG.id,
  },
  // Global (super) admin — no org membership; access to /admin via isGlobalAdmin.
  globalAdmin: {
    id: 'test-global-admin-user',
    email: 'global-admin@test.jobsphere.com',
    password: TEST_PASSWORD,
    name: 'Test Global Admin',
    role: null,
    isGlobalAdmin: true,
  },
} as const

// Deterministic job fixtures. Several specs (candidate-flow, candidate-search,
// jobs) navigate by picking "the first job card on /jobs" — with an empty
// database those locators simply time out, which is how this suite spent a long
// time reporting `locator.getAttribute: Timeout` instead of a real regression.
// The three jobs below differ in work mode, employment type and seniority so
// the filter specs have something to actually filter.
// Ids are deterministic but must still satisfy `z.string().cuid()` — the
// applications API validates jobId with it, so a readable id like
// "test-job-react-senior" makes every apply request fail with the generic
// "Invalid application data". Zod's cuid check is /^c[^\s-]{8,}$/.
export const TEST_JOBS = [
  {
    id: 'ctestjob0reactsenior001',
    title: 'Senior React Developer',
    slug: 'senior-react-developer',
    description:
      'We are looking for a Senior React Developer to build modern web applications. ' +
      'You will work with React, TypeScript and Next.js on a distributed team.',
    employmentType: 'FULL_TIME',
    seniority: 'SENIOR',
    remote: true,
    hybrid: false,
    city: 'Bratislava',
    region: 'BA',
    salaryMin: 60000,
    salaryMax: 90000,
  },
  {
    id: 'ctestjob0pythonbackend1',
    title: 'Backend Engineer (Python)',
    slug: 'backend-engineer-python',
    description:
      'Join our backend team to design and operate Python services. ' +
      'Experience with PostgreSQL, Django and distributed systems is welcome.',
    employmentType: 'FULL_TIME',
    seniority: 'MID',
    remote: false,
    hybrid: false,
    city: 'Kosice',
    region: 'KE',
    salaryMin: 45000,
    salaryMax: 65000,
  },
  {
    id: 'ctestjob0qajunior000001',
    title: 'Junior QA Tester',
    slug: 'junior-qa-tester',
    description:
      'Entry level QA position focused on manual and automated testing of web applications. ' +
      'You will learn Playwright and help keep our release quality high.',
    employmentType: 'PART_TIME',
    seniority: 'ENTRY',
    remote: false,
    hybrid: true,
    city: 'Zilina',
    region: 'ZA',
    salaryMin: 20000,
    salaryMax: 30000,
  },
] as const

/**
 * Create the published test jobs owned by the test organization.
 * Created by the recruiter user, so employer-side specs see them too.
 */
export async function createTestJobs(prisma: PrismaClient) {
  const createdBy = TEST_USERS.recruiter.id

  for (const job of TEST_JOBS) {
    const data = {
      orgId: TEST_ORG.id,
      title: job.title,
      slug: job.slug,
      description: job.description,
      employmentType: job.employmentType,
      seniority: job.seniority,
      remote: job.remote,
      hybrid: job.hybrid,
      city: job.city,
      region: job.region,
      country: 'SK',
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      locale: 'en',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      createdBy,
    }

    await prisma.job.upsert({
      where: { id: job.id },
      update: data,
      create: { id: job.id, ...data },
    })
  }

  return TEST_JOBS
}

/**
 * Create test organization in database
 */
export async function createTestOrganization(prisma: PrismaClient) {
  return await prisma.organization.upsert({
    where: { id: TEST_ORG.id },
    update: {},
    create: {
      id: TEST_ORG.id,
      name: TEST_ORG.name,
      slug: TEST_ORG.slug,
      description: TEST_ORG.description,
      industry: TEST_ORG.industry,
      size: TEST_ORG.size,
      website: TEST_ORG.website,
      settings: {},
      features: {},
    },
  })
}

/**
 * Create a test user with the specified role
 */
export async function createTestUser(prisma: PrismaClient, userKey: keyof typeof TEST_USERS) {
  const userData = TEST_USERS[userKey]
  const hashedPassword = await hash(userData.password, 10)

  // Create user
  const user = await prisma.user.upsert({
    where: { id: userData.id },
    update: {},
    create: {
      id: userData.id,
      email: userData.email,
      password: hashedPassword,
      name: userData.name,
      emailVerified: new Date(), // Auto-verify test users
      locale: 'en',
      timezone: 'UTC',
      isGlobalAdmin: 'isGlobalAdmin' in userData ? userData.isGlobalAdmin : false,
    },
  })

  // Create organization membership if user has a role
  if (userData.role && userData.orgId) {
    await prisma.userOrgRole.upsert({
      where: {
        userId_orgId: {
          userId: user.id,
          orgId: userData.orgId,
        },
      },
      update: {},
      create: {
        userId: user.id,
        orgId: userData.orgId,
        role: userData.role,
        permissions: [],
      },
    })
  }

  return user
}

/**
 * Create all test users (for use in global setup)
 */
export async function createAllTestUsers(prisma: PrismaClient) {
  // First create the organization
  await createTestOrganization(prisma)

  // Then create all users
  const users = await Promise.all([
    createTestUser(prisma, 'candidate'),
    createTestUser(prisma, 'recruiter'),
    createTestUser(prisma, 'orgAdmin'),
    createTestUser(prisma, 'hiringManager'),
    createTestUser(prisma, 'agency'),
    createTestUser(prisma, 'globalAdmin'),
  ])

  // Jobs depend on the recruiter existing, so this runs after the users.
  await createTestJobs(prisma)

  return {
    organization: TEST_ORG,
    users: {
      candidate: users[0],
      recruiter: users[1],
      orgAdmin: users[2],
      hiringManager: users[3],
      agency: users[4],
      globalAdmin: users[5],
    },
  }
}

/**
 * Clean up all test users, their organization and everything the E2E run created
 * underneath it.
 *
 * The previous version deleted only `userOrgRole`, the users and then the
 * organization. Almost none of Organization's relations are `onDelete: Cascade`
 * (only Branch, Tag and Task are), so the moment a spec created a job, an
 * assessment or an email sequence the final `organization.deleteMany` died on a
 * foreign-key violation — printed as a scary teardown failure on every single
 * run, while test rows quietly accumulated in the database.
 *
 * Deletes now run children-first. Every statement is scoped through a relation
 * back to the test organization (or to the fixed test user ids), so this never
 * touches rows the suite did not create.
 */
export async function cleanupTestData(prisma: PrismaClient) {
  const orgId = TEST_ORG.id
  const userIds = [
    TEST_USERS.candidate.id,
    TEST_USERS.recruiter.id,
    TEST_USERS.orgAdmin.id,
    TEST_USERS.hiringManager.id,
    TEST_USERS.agency.id,
    TEST_USERS.globalAdmin.id,
  ]

  const byOrg = { orgId }
  // Candidate rows reachable either through the test org or through a test user.
  // Scoping only by org left behind candidates a spec had attached to a test
  // user under a different org, and their child rows then blocked the delete.
  const testCandidate = { OR: [{ orgId }, { userId: { in: userIds } }] }
  const candidateOfOrg = { candidate: testCandidate }

  // Depth 4 — grandchildren of assessments / sequences / applications.
  await prisma.answer.deleteMany({ where: { attempt: candidateOfOrg } })
  await prisma.emailSequenceEvent.deleteMany({
    where: { run: { OR: [{ sequence: byOrg }, { candidate: testCandidate }] } },
  })
  await prisma.emailEvent.deleteMany({ where: { message: { thread: byOrg } } })
  await prisma.applicationActivity.deleteMany({
    where: { application: { OR: [byOrg, { candidate: testCandidate }] } },
  })

  // Depth 3.
  await prisma.attempt.deleteMany({ where: { candidate: testCandidate } })
  await prisma.question.deleteMany({ where: { section: { assessment: byOrg } } })
  await prisma.emailMessage.deleteMany({ where: { thread: byOrg } })
  await prisma.emailSequenceRun.deleteMany({
    where: { OR: [{ sequence: byOrg }, { candidate: testCandidate }] },
  })
  await prisma.interview.deleteMany({ where: byOrg })

  // Depth 2.
  await prisma.assessmentSection.deleteMany({ where: { assessment: byOrg } })
  await prisma.emailStep.deleteMany({ where: { sequence: byOrg } })
  await prisma.assessmentInvite.deleteMany({ where: { candidate: testCandidate } })
  await prisma.task.deleteMany({ where: byOrg })
  await prisma.matchScore.deleteMany({
    where: { OR: [byOrg, { candidate: testCandidate }] },
  })
  await prisma.savedJob.deleteMany({ where: { job: byOrg } })
  await prisma.application.deleteMany({
    where: { OR: [byOrg, { candidate: testCandidate }] },
  })

  // Candidate-owned leaves.
  await prisma.candidateTag.deleteMany({ where: candidateOfOrg })
  await prisma.candidateContact.deleteMany({ where: candidateOfOrg })
  await prisma.consentRecord.deleteMany({ where: candidateOfOrg })
  await prisma.resume.deleteMany({ where: candidateOfOrg })
  await prisma.candidateDocument.deleteMany({ where: candidateOfOrg })

  // Depth 1 — direct children of the organization.
  await prisma.assessment.deleteMany({ where: byOrg })
  await prisma.emailSequence.deleteMany({ where: byOrg })
  await prisma.emailThread.deleteMany({ where: byOrg })
  await prisma.emailAccount.deleteMany({ where: byOrg })
  await prisma.emailTemplate.deleteMany({ where: byOrg })
  await prisma.job.deleteMany({ where: byOrg })
  await prisma.candidate.deleteMany({ where: testCandidate })
  await prisma.gig.deleteMany({ where: byOrg })
  await prisma.tag.deleteMany({ where: byOrg })
  await prisma.branch.deleteMany({ where: byOrg })
  await prisma.auditLog.deleteMany({ where: byOrg })
  await prisma.usageEvent.deleteMany({ where: byOrg })
  await prisma.entitlement.deleteMany({ where: byOrg })
  await prisma.invoice.deleteMany({ where: byOrg })
  await prisma.subscription.deleteMany({ where: byOrg })
  await prisma.orgCustomer.deleteMany({ where: byOrg })
  await prisma.userOrgRole.deleteMany({ where: byOrg })

  // User-owned rows that block `user.deleteMany` on their own.
  await prisma.savedJob.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.consentRecord.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.dSARRequest.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.account.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } })

  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
}

/**
 * Get user credentials for login
 */
export function getUserCredentials(userKey: keyof typeof TEST_USERS) {
  const user = TEST_USERS[userKey]
  return {
    email: user.email,
    password: user.password,
  }
}
