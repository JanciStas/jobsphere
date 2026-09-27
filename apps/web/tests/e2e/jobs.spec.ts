/**
 * E2E Tests - Job Browsing
 *
 * The app's default locale is `sk`: an unprefixed path 307-redirects to `/sk/...`
 * and renders Slovak copy, so every navigation below is explicitly `/en`.
 */

import { test, expect } from '@playwright/test'

test.describe('Job Browsing', () => {
  test('should display jobs page', async ({ page }) => {
    await page.goto('/en/jobs')

    // The real h1 is `jobs.title` from the message catalog — "Latest Job
    // Opportunities", never "Browse Jobs".
    await expect(page.getByRole('heading', { name: /latest job opportunities/i })).toBeVisible()
  })

  test('should filter jobs by keyword', async ({ page }) => {
    await page.goto('/en/jobs')

    const searchInput = page.getByPlaceholder(/search by position/i)
    await searchInput.fill('developer')

    // The input is not in a form — Enter submits nothing. The client debounces
    // for 500 ms and then mirrors the term into the URL as `search=`, not `q=`.
    await expect(page).toHaveURL(/search=developer/, { timeout: 10000 })
  })

  test('should navigate to job detail page', async ({ page }) => {
    await page.goto('/en/jobs')

    // Job cards carry no data-testid; each card's CTA is a "View Details" link.
    const firstJob = page.getByRole('link', { name: /view details/i }).first()
    await expect(firstJob).toBeVisible()
    await firstJob.click()

    // Seeded job ids contain hyphens (e.g. `test-job-react-senior`).
    await expect(page).toHaveURL(/\/jobs\/[a-zA-Z0-9-]+/)

    // The Apply CTA is `<Button asChild><Link>` — it has role=link, not button.
    await expect(page.getByRole('link', { name: /apply now/i })).toBeVisible()
  })

  test('should show job filters', async ({ page }) => {
    await page.goto('/en/jobs')

    // Filters are dropdown trigger buttons. There is no "Location" label on this
    // page — location is only the placeholder of the second search input.
    await expect(page.getByRole('button', { name: /work mode/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /job type/i })).toBeVisible()
  })
})
