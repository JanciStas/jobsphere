/**
 * Example test file demonstrating the use of authentication fixtures
 *
 * This file shows how to use the pre-authenticated user fixtures
 * for different roles in your E2E tests.
 *
 * To run this test:
 *   yarn test:e2e auth-fixtures.example.spec.ts
 */

import { test, expect } from '@/tests/fixtures/auth'

test.describe('Authentication Fixtures Examples', () => {
  /**
   * Example 1: Using the candidate user fixture
   */
  test('candidate can access dashboard', async ({ candidateUser }) => {
    // Navigate to candidate dashboard
    await candidateUser.goto('/en/dashboard')

    // Verify we're on the dashboard
    await expect(candidateUser).toHaveURL(/\/en\/dashboard/)

    // Verify candidate can see their profile. The dashboard greets the user in
    // its <h1> ("Welcome back, {name}!"), and once the header hydrates the same
    // name also appears in the account menu button — so a bare
    // `text=Test Candidate` matches two elements and dies on strict mode.
    await expect(
      candidateUser.getByRole('heading', { name: /welcome back, test candidate/i }),
    ).toBeVisible()
  })

  /**
   * Example 2: Using the recruiter user fixture
   */
  test('recruiter can access employer dashboard', async ({ recruiterUser }) => {
    // Navigate to employer dashboard
    await recruiterUser.goto('/en/employer')

    // Verify we're on the employer dashboard
    await expect(recruiterUser).toHaveURL(/\/en\/employer/)

    // Verify recruiter role is active
    await expect(recruiterUser.locator('text=Test Recruiter')).toBeVisible()
  })

  /**
   * Example 3: Using the org admin user fixture
   */
  test('org admin can access organization settings', async ({ orgAdminUser }) => {
    // Navigate to organization settings
    await orgAdminUser.goto('/en/employer/settings')

    // Verify we're on the settings page
    await expect(orgAdminUser).toHaveURL(/\/employer\/settings/)

    // Admin should see organization management options. The page calls them
    // "Company …", never "Organization" — the only visible match for that word
    // was the prose subtitle plus the profile tab's card description, i.e. two
    // elements and a strict-mode failure.
    await expect(
      orgAdminUser.getByRole('heading', { name: 'Company Settings', level: 1 }),
    ).toBeVisible()
    await expect(orgAdminUser.getByRole('tab', { name: 'Company Profile' })).toBeVisible()
    await expect(orgAdminUser.getByRole('tab', { name: 'Team Members' })).toBeVisible()
  })

  /**
   * Example 4: Using the hiring manager fixture
   */
  test('hiring manager can view jobs', async ({ hiringManagerUser }) => {
    // Navigate to jobs list
    await hiringManagerUser.goto('/en/employer/jobs')

    // Verify we're on the jobs page
    await expect(hiringManagerUser).toHaveURL(/\/employer\/jobs/)
  })

  /**
   * Example 5: Using multiple roles in one test
   */
  test('different roles have different access levels', async ({ candidateUser, recruiterUser }) => {
    // Candidate cannot access employer routes
    await candidateUser.goto('/en/employer')
    // Should be redirected or see access denied
    await expect(candidateUser).not.toHaveURL(/\/employer/)

    // Recruiter CAN access employer routes
    await recruiterUser.goto('/en/employer')
    await expect(recruiterUser).toHaveURL(/\/employer/)
  })

  /**
   * Example 6: Using the context factory for dynamic role testing
   */
  test('can create multiple authenticated contexts', async ({ createAuthenticatedContext }) => {
    // Create contexts for different roles
    const { page: recruiterPage } = await createAuthenticatedContext('recruiter')
    const { page: candidatePage } = await createAuthenticatedContext('candidate')

    // Each page has its own authentication
    await recruiterPage.goto('/en/employer')
    await expect(recruiterPage).toHaveURL(/\/employer/)

    await candidatePage.goto('/en/dashboard')
    await expect(candidatePage).toHaveURL(/\/dashboard/)

    // Contexts are automatically closed after the test
  })
})

test.describe('Test User Data Verification', () => {
  /**
   * Verify test users are properly seeded
   */
  test('test users have correct roles', async ({ recruiterUser, orgAdminUser }) => {
    // Recruiter should be part of "Test Org Inc"
    await recruiterUser.goto('/en/employer')
    await expect(recruiterUser.locator('text=Test Org Inc')).toBeVisible()

    // Org Admin should have admin privileges
    await orgAdminUser.goto('/en/employer/settings')
    await expect(orgAdminUser).toHaveURL(/\/employer\/settings/)
  })
})
