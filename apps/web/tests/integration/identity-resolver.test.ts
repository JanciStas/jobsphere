/**
 * Identity resolver integration tests (real DB).
 *
 * Locks in the canonical Candidate<->User resolution that the whole candidate
 * self-service surface depends on (CQ-001 / LOGIC-005 / AUTH-004):
 *   1. create-and-link on first use,
 *   2. idempotent reuse on subsequent calls,
 *   3. link an existing recruiter-imported candidate by primary-contact email
 *      instead of creating a duplicate,
 *   4. getCandidateIdsForUser returns linked ids and ignores soft-deleted rows.
 *
 * Runs against the CI Postgres (see vitest.integration.config.ts). The global
 * setup.ts seeds the base org/users and cleans dynamic data between tests.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { getOrCreateCandidateForUser, getCandidateIdsForUser } from '@/lib/identity'
import { prisma, TEST_IDS, createTestCandidate } from './helpers/test-db'

// Throwaway users created by this file (explicit `test-user-` ids so the global
// afterAll cleanup — which deletes users with that prefix — removes them too).
const U = {
  fresh: 'test-user-idn-fresh',
  link: 'test-user-idn-link',
  noemail: 'test-user-idn-noemail',
} as const

// Upsert, not create. cleanupDynamicData (the global beforeEach) only removes
// org-scoped rows — User is deliberately left alone — so the same throwaway user
// survives into the next test in this file and a second `create` blew up with
// P2002 on `id`. The tests are each meant to start from "this user exists".
async function makeUser(id: string, email: string | null, name = 'Idn User') {
  return prisma.user.upsert({
    where: { id },
    update: { email: email as string, name, locale: 'en' },
    create: { id, email: email as string, name, locale: 'en' },
  })
}

afterAll(async () => {
  // Candidates are cleaned per-test by cleanupDynamicData (orgId scoped), but the
  // LAST test's rows are still there when this runs — and CandidateContact holds a
  // non-cascading FK to Candidate, so deleting candidates first raised P2003
  // (CandidateContact_candidateId_fkey) and failed the file even with every test
  // green. Leaves first, as everywhere else in this suite.
  const userIds = Object.values(U)
  await prisma.candidateContact.deleteMany({
    where: { candidate: { userId: { in: userIds } } },
  })
  await prisma.candidate.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
})

describe('identity resolver — getOrCreateCandidateForUser (integration)', () => {
  it('creates and links a candidate on first use, with a primary contact from the user', async () => {
    await makeUser(U.fresh, 'idn.fresh@test.com', 'Fresh Seeker')

    const candidate = await getOrCreateCandidateForUser(U.fresh, TEST_IDS.org)

    expect(candidate.userId).toBe(U.fresh)
    expect(candidate.orgId).toBe(TEST_IDS.org)

    const contact = await prisma.candidateContact.findFirst({
      where: { candidateId: candidate.id, isPrimary: true },
    })
    expect(contact?.email).toBe('idn.fresh@test.com')
  })

  it('is idempotent — a second call returns the same candidate, no duplicate', async () => {
    await makeUser(U.fresh, 'idn.fresh@test.com', 'Fresh Seeker')

    const first = await getOrCreateCandidateForUser(U.fresh, TEST_IDS.org)
    const second = await getOrCreateCandidateForUser(U.fresh, TEST_IDS.org)

    expect(second.id).toBe(first.id)

    const count = await prisma.candidate.count({
      where: { userId: U.fresh, orgId: TEST_IDS.org, deletedAt: null },
    })
    expect(count).toBe(1)
  })

  it('links an existing unlinked candidate by primary-contact email instead of duplicating', async () => {
    await makeUser(U.link, 'imported@test.com', 'Imported Person')

    // Recruiter-imported candidate: same primary email, no linked user.
    const imported = await createTestCandidate({ source: 'IMPORT' })
    await prisma.candidateContact.create({
      data: {
        candidateId: imported.id,
        fullName: 'Imported Person',
        email: 'imported@test.com',
        isPrimary: true,
      },
    })

    const resolved = await getOrCreateCandidateForUser(U.link, TEST_IDS.org)

    // Linked the existing row rather than creating a new one.
    expect(resolved.id).toBe(imported.id)
    expect(resolved.userId).toBe(U.link)

    const total = await prisma.candidate.count({ where: { orgId: TEST_IDS.org } })
    expect(total).toBe(1)
  })

  it('throws when the user has no email (cannot resolve a candidate)', async () => {
    // A user with an empty email cannot be matched/created as a candidate.
    await makeUser(U.noemail, '', 'No Email')

    await expect(getOrCreateCandidateForUser(U.noemail, TEST_IDS.org)).rejects.toThrow()
  })
})

describe('identity resolver — getCandidateIdsForUser (integration)', () => {
  it('returns linked candidate ids and ignores soft-deleted candidates', async () => {
    await makeUser(U.fresh, 'idn.fresh@test.com', 'Fresh Seeker')

    const active = await getOrCreateCandidateForUser(U.fresh, TEST_IDS.org)
    const deleted = await createTestCandidate({ userId: U.fresh, deletedAt: new Date() })

    const ids = await getCandidateIdsForUser(U.fresh)

    expect(ids).toContain(active.id)
    expect(ids).not.toContain(deleted.id)
  })
})
