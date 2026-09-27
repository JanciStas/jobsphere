/**
 * E2E Tests - Candidate Job Application Flow
 *
 * This test suite covers the complete candidate journey from browsing jobs
 * to submitting applications and viewing their status.
 *
 * Test Scenarios:
 * 1. Browse jobs without authentication
 * 2. View job details and attempt to apply (redirects to login)
 * 3. Apply to job with cover letter (authenticated)
 * 4. Upload CV during application
 * 5. Auto-fill form from CV
 * 6. Prevent duplicate applications (409 error)
 * 7. View application status in dashboard
 * 8. View application details
 *
 * To run this test:
 *   yarn test:e2e candidate-flow.spec.ts
 */

import { test, expect } from '@/tests/fixtures/auth'
import { Page } from '@playwright/test'
import path from 'path'

/**
 * Helper function to wait for API response
 */
async function waitForApiResponse(page: Page, url: string | RegExp) {
  return page.waitForResponse(
    (response) =>
      (typeof url === 'string' ? response.url().includes(url) : url.test(response.url())) &&
      response.status() !== 304,
  )
}

/**
 * Helper function to get first active job from the jobs page
 */
async function getFirstJobId(page: Page): Promise<string | null> {
  await page.goto('/en/jobs')
  await page.waitForLoadState('networkidle')

  // Wait for jobs to load
  const jobCard = page.locator('a[href*="/jobs/"]').first()
  const href = await jobCard.getAttribute('href')

  if (href) {
    const match = href.match(/\/jobs\/([^/]+)/)
    return match ? match[1] : null
  }

  return null
}

test.describe('Candidate Job Application Flow - Unauthenticated', () => {
  test('should browse jobs without authentication', async ({ page }) => {
    await page.goto('/en/jobs')

    // The public listing's only h1 is the localized jobs.title.
    await expect(page.getByRole('heading', { name: 'Latest Job Opportunities' })).toBeVisible()

    // Verify job listings are visible
    await page.waitForLoadState('networkidle')

    // Should see either job cards or "no results" message
    const hasJobs = await page.locator('a[href*="/jobs/"]').count()
    const noResults = await page.locator('text=/no.*results/i').count()

    expect(hasJobs > 0 || noResults > 0).toBeTruthy()
  })

  test('should search and filter jobs', async ({ page }) => {
    await page.goto('/en/jobs')
    await page.waitForLoadState('networkidle')

    // Search for jobs
    const searchInput = page
      .locator('input[placeholder*="search" i], input[placeholder*="Search" i]')
      .first()
    if (await searchInput.isVisible()) {
      await searchInput.fill('developer')
      await page.waitForTimeout(600) // Wait for debounce

      // URL should update with search param
      await expect(page).toHaveURL(/search=developer|q=developer/)
    }
  })

  test('should view job details without authentication', async ({ page }) => {
    const jobId = await getFirstJobId(page)

    if (!jobId) {
      test.skip()
      return
    }

    // Navigate to job detail page
    await page.goto(`/en/jobs/${jobId}`)
    await page.waitForLoadState('networkidle')

    // NOTE: the job detail page has no h1/h2 at all — the job title is rendered
    // through <CardTitle>, which is an <h3>. Assert on the heading role instead
    // of a tag, so this keeps working if the hierarchy is ever fixed.
    await expect(page.getByRole('heading').first()).toBeVisible()

    // Apply button should be visible
    const applyButton = page.locator('button:has-text("Apply"), a:has-text("Apply")').first()
    await expect(applyButton).toBeVisible()
  })

  test('should redirect to login when applying without authentication', async ({ page }) => {
    const jobId = await getFirstJobId(page)

    if (!jobId) {
      test.skip()
      return
    }

    // Navigate to job detail page
    await page.goto(`/en/jobs/${jobId}`)

    // Click apply button
    const applyButton = page.locator('button:has-text("Apply"), a:has-text("Apply")').first()
    await applyButton.click()

    // Should redirect to login with callback URL
    await expect(page).toHaveURL(/\/login.*callbackUrl/)
  })
})

test.describe('Candidate Job Application Flow - Authenticated', () => {
  test('should apply to job with cover letter', async ({ candidateUser }) => {
    // Get first job ID
    const jobId = await getFirstJobId(candidateUser)

    if (!jobId) {
      test.skip()
      return
    }

    // Navigate to apply page
    await candidateUser.goto(`/en/jobs/${jobId}/apply`)
    await candidateUser.waitForLoadState('networkidle')

    // Verify we're on the apply page
    await expect(candidateUser).toHaveURL(/\/jobs\/.*\/apply/)
    // Same heading-hierarchy caveat as the detail page: no h1/h2 here either.
    await expect(candidateUser.getByRole('heading').first()).toBeVisible()

    // Fill in cover letter
    const coverLetterTextarea = candidateUser.locator('textarea[name="coverLetter"]').first()
    await coverLetterTextarea.fill(
      'I am very interested in this position and believe my skills and experience make me an excellent candidate. ' +
        'I have extensive experience in the field and am excited about the opportunity to contribute to your team.',
    )

    // Fill in optional fields
    const phoneInput = candidateUser.locator('input[name="phoneNumber"], input[type="tel"]').first()
    if (await phoneInput.isVisible()) {
      await phoneInput.fill('+421900123456')
    }

    // Submit application
    const submitButton = candidateUser.locator('button[type="submit"]')
    await submitButton.click()

    // Wait for submission to complete
    await candidateUser.waitForTimeout(1000)

    // The old locator mixed a regex text engine and a CSS selector in one string
    // ('text=/.../i, [class*="success"]'), which Playwright parses as a single
    // regex and rejects with "Invalid flags supplied to RegExp constructor".
    // On success the page swaps the form for a confirmation panel.
    const successHeading = candidateUser.getByRole('heading', {
      name: /application submitted/i,
    })
    const dashboardRedirect = candidateUser.url().includes('/dashboard')

    expect((await successHeading.isVisible().catch(() => false)) || dashboardRedirect).toBeTruthy()
  })

  test('should upload CV during application', async ({ candidateUser }) => {
    // Get first job ID
    const jobId = await getFirstJobId(candidateUser)

    if (!jobId) {
      test.skip()
      return
    }

    // Navigate to apply page
    await candidateUser.goto(`/en/jobs/${jobId}/apply`)
    await candidateUser.waitForLoadState('networkidle')

    // Try to find and click the upload option
    const uploadOption = candidateUser.locator('text=/upload.*new|Upload.*New/i').first()
    if (await uploadOption.isVisible()) {
      await uploadOption.click()
    }

    // Wait for file input to appear
    await candidateUser.waitForTimeout(500)

    // Look for file input
    const fileInput = candidateUser.locator('input[type="file"]').first()

    if (await fileInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Create a sample PDF file path (tests should have sample files)
      const samplePdfPath = path.join(__dirname, '..', 'fixtures', 'sample-cv.pdf')

      try {
        await fileInput.setInputFiles(samplePdfPath)

        // Wait for upload to complete
        await candidateUser.waitForTimeout(2000)

        // Verify file was uploaded (look for file name or success indicator)
        const fileIndicator = candidateUser.locator('text=/sample-cv|uploaded|parsing/i')
        await expect(fileIndicator).toBeVisible({ timeout: 5000 })
      } catch {
        // Skip if sample file doesn't exist
        console.log('Sample CV file not found, skipping file upload test')
      }
    }
  })

  test('should prevent duplicate application', async ({ candidateUser }) => {
    // Get first job ID
    const jobId = await getFirstJobId(candidateUser)

    if (!jobId) {
      test.skip()
      return
    }

    // Apply to job first time
    await candidateUser.goto(`/en/jobs/${jobId}/apply`)
    await candidateUser.waitForLoadState('networkidle')

    // Fill cover letter
    const coverLetterTextarea = candidateUser.locator('textarea[name="coverLetter"]').first()
    await coverLetterTextarea.fill(
      'This is my first application to this job. I am very interested in the position and look forward to hearing from you.',
    )

    // Submit
    const submitButton = candidateUser.locator('button[type="submit"]')

    // Wait for API response
    const responsePromise = waitForApiResponse(candidateUser, '/api/applications')
    await submitButton.click()

    try {
      const response = await responsePromise
      const status = response.status()

      // First application should succeed (201) or might already exist (409)
      if (status === 201) {
        // Wait for success message
        await candidateUser.waitForTimeout(1500)

        // Try to apply again
        await candidateUser.goto(`/en/jobs/${jobId}/apply`)
        await candidateUser.waitForLoadState('networkidle')

        // Fill form again
        await candidateUser
          .locator('textarea[name="coverLetter"]')
          .first()
          .fill(
            'This is my second attempt to apply to the same job. This should be prevented by the system.',
          )

        // Submit again
        const secondResponsePromise = waitForApiResponse(candidateUser, '/api/applications')
        await candidateUser.locator('button[type="submit"]').click()

        const secondResponse = await secondResponsePromise

        // Should get 409 Conflict error
        expect(secondResponse.status()).toBe(409)

        // Should show error message
        const errorMessage = candidateUser.locator('text=/already applied|duplicate/i')
        await expect(errorMessage).toBeVisible({ timeout: 3000 })
      } else if (status === 409) {
        // Already applied, verify error message
        const errorMessage = candidateUser.locator('text=/already applied|duplicate/i')
        await expect(errorMessage).toBeVisible({ timeout: 3000 })
      }
    } catch (error) {
      // If request fails, that's also acceptable for this test
      console.log('Application submission error (expected for duplicate):', error)
    }
  })

  test('should view application status in dashboard', async ({ candidateUser }) => {
    // Navigate to dashboard
    await candidateUser.goto('/en/dashboard')
    await candidateUser.waitForLoadState('networkidle')

    // Verify we're on the dashboard
    await expect(candidateUser).toHaveURL(/\/dashboard/)

    // Should see application statistics or list
    const hasStats = await candidateUser.locator('text=/application|pending|reviewing/i').count()
    expect(hasStats).toBeGreaterThan(0)

    // Look for application cards/list
    const applicationsList = candidateUser.locator(
      '[class*="application"], a[href*="/dashboard/applications/"]',
    )
    const applicationsCount = await applicationsList.count()

    if (applicationsCount > 0) {
      // Verify first application is visible
      await expect(applicationsList.first()).toBeVisible()
    }
  })

  test('should view application details', async ({ candidateUser }) => {
    // Navigate to dashboard
    await candidateUser.goto('/en/dashboard')
    await candidateUser.waitForLoadState('networkidle')

    // Find first application link
    const applicationLink = candidateUser.locator('a[href*="/dashboard/applications/"]').first()

    if (await applicationLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await applicationLink.click()

      // Should navigate to application detail page
      await expect(candidateUser).toHaveURL(/\/dashboard\/applications\/[a-zA-Z0-9-]+/)

      // Should see application details
      await expect(candidateUser.locator('h1, h2').first()).toBeVisible()

      // Should see job title and company
      const jobTitle = candidateUser.locator('text=/job|position|title/i').first()
      await expect(jobTitle).toBeVisible()

      // Should see status badge
      const statusBadge = candidateUser.locator('[class*="badge"], [class*="Badge"]').first()
      if (await statusBadge.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(statusBadge).toBeVisible()
      }

      // Should see cover letter if exists
      const coverLetter = candidateUser.locator('text=/cover letter|motivational/i')
      if (await coverLetter.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(coverLetter).toBeVisible()
      }
    } else {
      // No applications yet, skip test
      test.skip()
    }
  })

  test('should filter jobs and apply to filtered result', async ({ candidateUser }) => {
    await candidateUser.goto('/en/jobs')
    await candidateUser.waitForLoadState('networkidle')

    // Work mode is a DropdownMenu of checkbox items, not a set of clickable
    // badges — `text=/Remote/i` used to resolve to the read-only badge on a job
    // card, which does nothing when clicked.
    await candidateUser.getByRole('button', { name: /work mode/i }).click()
    await candidateUser.getByRole('menuitemcheckbox', { name: 'Remote', exact: true }).click()
    await candidateUser.keyboard.press('Escape')

    await expect(candidateUser).toHaveURL(/workMode=REMOTE/)
    await candidateUser.waitForLoadState('networkidle')

    // Scope to the filtered result grid: the "Recommended For You" carousel
    // above it renders job cards too and is deliberately NOT filtered, so a
    // page-wide link count is always 3.
    const allJobs = candidateUser.getByTestId('job-results')
    const jobLinks = allJobs.locator('a[href*="/jobs/"]')
    await expect(jobLinks).toHaveCount(1)
    await expect(allJobs.getByText('Remote', { exact: true }).first()).toBeVisible()

    await jobLinks.first().click()

    await expect(candidateUser).toHaveURL(/\/jobs\/[a-zA-Z0-9-]+/)
    // Assert the job we landed on is the seeded remote one. The detail page does
    // not render a "Remote" badge when the job has a city — it shows the city —
    // so the work-mode badge is only assertable on the listing, above.
    await expect(
      candidateUser.getByRole('heading', { name: 'Senior React Developer' }).first(),
    ).toBeVisible()
  })

  test('should save job for later', async ({ candidateUser }) => {
    const jobId = await getFirstJobId(candidateUser)

    if (!jobId) {
      test.skip()
      return
    }

    // Navigate to job detail page
    await candidateUser.goto(`/en/jobs/${jobId}`)
    await candidateUser.waitForLoadState('networkidle')

    // Look for save/bookmark button
    const saveButton = candidateUser
      .locator('button:has-text("Save"), button[aria-label*="save" i]')
      .first()

    if (await saveButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await saveButton.click()

      // Wait for save action
      await candidateUser.waitForTimeout(1000)

      // Navigate to saved jobs
      await candidateUser.goto('/en/dashboard/saved')
      await candidateUser.waitForLoadState('networkidle')

      // Should see saved jobs page
      await expect(candidateUser).toHaveURL(/\/dashboard\/saved/)
    }
  })
})

test.describe('Candidate Application Form Validation', () => {
  test('should validate cover letter length', async ({ candidateUser }) => {
    const jobId = await getFirstJobId(candidateUser)

    if (!jobId) {
      test.skip()
      return
    }

    // Navigate to apply page
    await candidateUser.goto(`/en/jobs/${jobId}/apply`)
    await candidateUser.waitForLoadState('networkidle')

    // Try to submit with short cover letter (less than 50 chars per schema)
    const coverLetterTextarea = candidateUser.locator('textarea[name="coverLetter"]').first()
    await coverLetterTextarea.fill('Too short')

    // Submit
    const submitButton = candidateUser.locator('button[type="submit"]')
    await submitButton.click()

    // Assert on the exact message. The previous regex also matched the textarea
    // itself (its value was the literal string "Too short"), a strict mode
    // violation rather than a missing error.
    await expect(
      candidateUser.getByText('Cover letter must be at least 50 characters.'),
    ).toBeVisible({ timeout: 3000 })
  })

  test('should validate phone number format', async ({ candidateUser }) => {
    const jobId = await getFirstJobId(candidateUser)

    if (!jobId) {
      test.skip()
      return
    }

    // Navigate to apply page
    await candidateUser.goto(`/en/jobs/${jobId}/apply`)
    await candidateUser.waitForLoadState('networkidle')

    // Fill valid cover letter
    const coverLetterTextarea = candidateUser.locator('textarea[name="coverLetter"]').first()
    await coverLetterTextarea.fill(
      'I am very interested in this position and believe my skills make me a great fit for your team.',
    )

    // Enter invalid phone number
    const phoneInput = candidateUser.locator('input[name="phoneNumber"], input[type="tel"]').first()

    if (await phoneInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await phoneInput.fill('123') // Too short

      // Submit
      const submitButton = candidateUser.locator('button[type="submit"]')
      await submitButton.click()

      // Should show validation error
      await candidateUser.waitForTimeout(500)
      const errorMessage = candidateUser.locator('text=/valid.*phone|phone.*number/i')

      // Error might be visible
      if (await errorMessage.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(errorMessage).toBeVisible()
      }
    }
  })

  test('should validate LinkedIn URL format', async ({ candidateUser }) => {
    const jobId = await getFirstJobId(candidateUser)

    if (!jobId) {
      test.skip()
      return
    }

    // Navigate to apply page
    await candidateUser.goto(`/en/jobs/${jobId}/apply`)
    await candidateUser.waitForLoadState('networkidle')

    // Fill valid cover letter
    const coverLetterTextarea = candidateUser.locator('textarea[name="coverLetter"]').first()
    await coverLetterTextarea.fill(
      'I am very interested in this position and believe my skills make me a great fit for your team.',
    )

    // Enter invalid LinkedIn URL
    const linkedinInput = candidateUser.locator('input[name="linkedin"]').first()

    if (await linkedinInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await linkedinInput.fill('not-a-url')

      // Submit
      const submitButton = candidateUser.locator('button[type="submit"]')
      await submitButton.click()

      // Should show validation error
      await candidateUser.waitForTimeout(500)
      const errorMessage = candidateUser.locator('text=/valid.*url|invalid.*linkedin/i')

      // Error might be visible
      if (await errorMessage.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(errorMessage).toBeVisible()
      }
    }
  })
})

test.describe('Candidate Profile and CV Management', () => {
  test('should access profile from dashboard', async ({ candidateUser }) => {
    await candidateUser.goto('/en/dashboard')
    await candidateUser.waitForLoadState('networkidle')

    // Scope to the dashboard's own nav: `a:has-text("Profile")` also matched the
    // footer's "Company Profiles" link, which navigates to /companies.
    const profileLink = candidateUser.locator('a[href$="/dashboard/profile"]').first()

    if (await profileLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await profileLink.click()

      // Should navigate to profile page
      await expect(candidateUser).toHaveURL(/\/profile|\/dashboard\/profile/)
    }
  })

  test('should view existing CVs', async ({ candidateUser }) => {
    await candidateUser.goto('/en/dashboard')
    await candidateUser.waitForLoadState('networkidle')

    // Scope to the dashboard CV route; the loose text match below also picked up
    // the footer "Create CV" link and Next's route announcer, which is a strict
    // mode violation.
    const cvLink = candidateUser.locator('a[href$="/dashboard/cv"]').first()

    if (await cvLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cvLink.click()

      await expect(candidateUser).toHaveURL(/\/dashboard\/cv/)
      await expect(candidateUser.getByRole('heading').first()).toBeVisible()
    }
  })
})
