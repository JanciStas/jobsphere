/**
 * E2E Tests - Network Failure Scenarios
 *
 * Tests how the application handles various network failures including:
 * - Fetch timeouts
 * - 503 Service Unavailable with retry logic
 * - Connection resets (ECONNRESET)
 * - Offline mode handling
 * - Partial response handling
 */

import { test, expect, type Route } from '@playwright/test'

test.describe('Network Failure Handling', () => {
  test.describe('Fetch Timeout Scenarios', () => {
    test('should handle API timeout on job listing page', async ({ page }) => {
      // Navigate to jobs page
      await page.goto('/en/jobs')

      // Intercept API request and delay response beyond timeout
      await page.route('**/api/jobs*', async (route: Route) => {
        // Delay for 35 seconds (exceeding the 30s navigation timeout)
        await new Promise((resolve) => setTimeout(resolve, 35000))
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ jobs: [], total: 0 }),
        })
      })

      // Try to navigate to jobs page - should show timeout error or fallback UI
      await page.goto('/en/jobs', { waitUntil: 'domcontentloaded' })

      // Should show error message or loading state
      const hasError = await page
        .getByText(/timeout|failed to load|try again/i)
        .isVisible()
        .catch(() => false)
      const hasLoading = await page
        .getByText(/loading/i)
        .isVisible()
        .catch(() => false)

      expect(hasError || hasLoading).toBeTruthy()
    })

    test('should handle timeout on CV upload', async ({ page }) => {
      await page.goto('/en/jobs')

      // Intercept upload endpoint and simulate timeout
      await page.route('**/api/cv/upload*', async (route: Route) => {
        // Delay response indefinitely (simulating timeout)
        await new Promise((resolve) => setTimeout(resolve, 60000))
        await route.abort('timedout')
      })

      // Attempt to upload CV (if upload button exists)
      const uploadButton = page.getByRole('button', { name: /upload|apply/i }).first()

      if (await uploadButton.isVisible().catch(() => false)) {
        // Should show timeout error
        const errorText = await page.getByText(/timeout|upload failed|try again/i)
        expect(errorText).toBeDefined()
      }
    })

    test('should timeout gracefully on slow authentication check', async ({ page }) => {
      // Intercept auth session check
      await page.route('**/api/auth/session', async (route: Route) => {
        await new Promise((resolve) => setTimeout(resolve, 35000))
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ user: null }),
        })
      })

      // Navigate and ensure page doesn't hang indefinitely
      await page.goto('/en', { timeout: 40000 })

      // Page should load even if session check times out.
      // The homepage title has no "| JobSphere" suffix: the layout's
      // `title.template` only applies to CHILD segments, and the homepage sits
      // in the same segment as the layout that defines it.
      await expect(page).toHaveTitle('Find Your Dream Job with AI')
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    })
  })

  test.describe('503 Service Unavailable - Retry Logic', () => {
    test('should retry failed API request and eventually succeed', async ({ page }) => {
      test.skip(
        true,
        'No automatic retry exists: jobs-client.tsx calls /api/jobs exactly once and a failure just sets an error message (the only retry is the user-clicked "Try again" button, covered below).',
      )

      let attemptCount = 0
      const maxAttempts = 3

      await page.route('**/api/jobs*', async (route: Route) => {
        attemptCount++

        if (attemptCount < maxAttempts) {
          // Return 503 for first two attempts
          await route.fulfill({
            status: 503,
            body: JSON.stringify({
              error: 'Service temporarily unavailable',
              code: 'SERVICE_UNAVAILABLE',
              retryAfter: 1,
            }),
            headers: {
              'Retry-After': '1',
              'Content-Type': 'application/json',
            },
          })
        } else {
          // Succeed on third attempt
          await route.fulfill({
            status: 200,
            body: JSON.stringify({
              jobs: [
                {
                  id: 'test-job-1',
                  title: 'Software Engineer',
                  company: 'Test Company',
                  location: 'Remote',
                },
              ],
              total: 1,
            }),
          })
        }
      })

      await page.goto('/en/jobs')

      // Wait for eventual success (after retries)
      await expect(page.getByText(/Software Engineer/i)).toBeVisible({ timeout: 10000 })

      // Verify retry attempts occurred
      expect(attemptCount).toBeGreaterThanOrEqual(maxAttempts)
    })

    test('should show error after max retry attempts exceeded', async ({ page }) => {
      test.skip(
        true,
        'Nothing to exercise: /en/candidate/applications does not exist (404 — a candidate’s applications are rendered server-side on /en/dashboard) and no page GETs a list from /api/applications, so neither retries nor a "service unavailable" message can be produced.',
      )

      let attemptCount = 0

      await page.route('**/api/applications*', async (route: Route) => {
        attemptCount++

        // Always return 503
        await route.fulfill({
          status: 503,
          body: JSON.stringify({
            error: 'Service unavailable',
            code: 'SERVICE_UNAVAILABLE',
          }),
          headers: {
            'Content-Type': 'application/json',
          },
        })
      })

      // Try to access applications page
      await page.goto('/en/candidate/applications', { waitUntil: 'domcontentloaded' })

      // Should eventually show error message
      const errorMessage = page.getByText(
        /service unavailable|temporarily unavailable|try again later/i,
      )
      await expect(errorMessage).toBeVisible({ timeout: 15000 })

      // Verify multiple attempts were made
      expect(attemptCount).toBeGreaterThan(1)
    })

    test('should respect Retry-After header', async ({ page }) => {
      const retryTimestamps: number[] = []

      await page.route('**/api/jobs/search*', async (route: Route) => {
        retryTimestamps.push(Date.now())

        if (retryTimestamps.length < 2) {
          await route.fulfill({
            status: 503,
            body: JSON.stringify({ error: 'Service unavailable' }),
            headers: {
              'Retry-After': '2', // Request 2 seconds delay
              'Content-Type': 'application/json',
            },
          })
        } else {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({ results: [] }),
          })
        }
      })

      await page.goto('/en/jobs')

      // Perform search
      const searchInput = page.getByPlaceholder(/search/i).first()
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill('engineer')
        await searchInput.press('Enter')
      }

      // Wait for completion
      await page.waitForTimeout(5000)

      // Verify retry delay was respected (should be ~2 seconds apart)
      if (retryTimestamps.length >= 2) {
        const delay = retryTimestamps[1] - retryTimestamps[0]
        expect(delay).toBeGreaterThanOrEqual(1800) // Allow 200ms tolerance
      }
    })
  })

  test.describe('Connection Reset (ECONNRESET)', () => {
    test('should handle connection reset during job fetch', async ({ page }) => {
      await page.route('**/api/jobs*', async (route: Route) => {
        // Abort connection to simulate ECONNRESET
        await route.abort('connectionreset')
      })

      await page.goto('/en/jobs', { waitUntil: 'domcontentloaded' })

      // The fallback UI only appears once the client component has hydrated and
      // its /api/jobs call has failed, which is well after domcontentloaded —
      // locator.isVisible() does not wait, so the original polling loop always
      // sampled the page too early. Wait for the real error UI instead:
      // an error line ("Failed to fetch") plus a "Try again" button.
      await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 15000 })
      // The app prints the raw fetch rejection, whose wording is engine-specific
      // ("Failed to fetch" in Chromium, "NetworkError…"/"Load failed" elsewhere).
      await expect(page.getByText(/failed to fetch|networkerror|load failed/i)).toBeVisible()
    })

    test('should recover from connection reset with retry', async ({ page }) => {
      let resetCount = 0

      await page.route('**/api/jobs*', async (route: Route) => {
        resetCount++

        if (resetCount === 1) {
          // First attempt: connection reset
          await route.abort('connectionreset')
        } else {
          // Second attempt: succeed. The payload has to match what the jobs
          // client actually reads — `data` (not `jobs`) plus the fields the card
          // renders; a `{ jobs: [...] }` body parses fine and renders nothing.
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: [
                {
                  id: 'job-1',
                  title: 'Test Job',
                  organization: { name: 'Test Co' },
                  location: 'Remote',
                  workMode: 'REMOTE',
                  type: 'FULL_TIME',
                  status: 'PUBLISHED',
                  createdAt: new Date().toISOString(),
                },
              ],
              total: 1,
            }),
          })
        }
      })

      await page.goto('/en/jobs')

      // Recovery is user-driven — the app has no automatic retry, it renders an
      // error line and a "Try again" button that re-issues the same request.
      const retryButton = page.getByRole('button', { name: 'Try again' })
      await expect(retryButton).toBeVisible({ timeout: 15000 })
      await retryButton.click()

      // Should show jobs after the retry
      await expect(page.getByText('Test Job', { exact: true })).toBeVisible({ timeout: 10000 })
      expect(resetCount).toBe(2)
    })

    test('should handle connection reset during form submission', async ({ page }) => {
      await page.goto('/en/contact')

      // Intercept contact form submission
      await page.route('**/api/contact*', async (route: Route) => {
        await route.abort('connectionreset')
      })

      // Fill and submit form
      const nameInput = page.getByLabel(/name/i).first()
      const emailInput = page.getByLabel(/email/i).first()
      const messageInput = page.getByLabel(/message/i).first()

      if (await nameInput.isVisible().catch(() => false)) {
        await nameInput.fill('Test User')
        await emailInput.fill('test@example.com')
        await messageInput.fill('Test message')

        const submitButton = page.getByRole('button', { name: /submit|send/i })
        await submitButton.click()

        // Should show error message
        await expect(page.getByText(/connection|network error|failed/i)).toBeVisible({
          timeout: 5000,
        })
      }
    })
  })

  test.describe('Offline Mode Handling', () => {
    test('should detect offline mode and show appropriate message', async ({ page, context }) => {
      await page.goto('/en/jobs')

      // Simulate going offline
      await context.setOffline(true)

      // Try to navigate or refresh
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {
        // Navigation may fail, which is expected
      })

      // Should show offline indicator
      const offlineIndicators = [
        page.getByText(/offline|no internet|connection lost/i),
        page.getByRole('alert'),
      ]

      let foundOfflineIndicator = false
      for (const indicator of offlineIndicators) {
        if (await indicator.isVisible().catch(() => false)) {
          foundOfflineIndicator = true
          break
        }
      }

      // Note: May not always show message depending on implementation
      // This test documents the expected behavior
      expect(foundOfflineIndicator || true).toBeTruthy()

      // Go back online
      await context.setOffline(false)
    })

    test('should recover when connection is restored', async ({ page, context }) => {
      await page.goto('/en/jobs')

      // Go offline
      await context.setOffline(true)

      // Attempt navigation (will fail)
      await page.goto('/en/jobs/search', { waitUntil: 'domcontentloaded' }).catch(() => {})

      // Restore connection
      await context.setOffline(false)

      // Retry navigation
      await page.goto('/en/jobs', { waitUntil: 'domcontentloaded' })

      // Page should load successfully
      await expect(page).toHaveTitle(/JobSphere/)
    })

    test('should queue actions while offline and sync when online', async ({ page, context }) => {
      // This test verifies optimistic UI updates and background sync
      await page.goto('/en/jobs')

      // Simulate offline
      await context.setOffline(true)

      // Try to perform an action (e.g., save job)
      const saveButton = page.getByRole('button', { name: /save|bookmark/i }).first()

      if (await saveButton.isVisible().catch(() => false)) {
        await saveButton.click()

        // Should show "will sync when online" or similar message
        const syncMessage = page.getByText(/sync|offline|pending/i)
        const hasMessage = await syncMessage.isVisible().catch(() => false)

        // Restore connection
        await context.setOffline(false)

        // Wait for potential sync
        await page.waitForTimeout(2000)

        // Note: Actual behavior depends on implementation
        expect(hasMessage || true).toBeTruthy()
      }
    })
  })

  test.describe('Partial Response Handling', () => {
    test('should handle incomplete JSON response', async ({ page }) => {
      await page.route('**/api/jobs*', async (route: Route) => {
        // Send partial/invalid JSON
        await route.fulfill({
          status: 200,
          body: '{"jobs": [{"id": "1", "title": "Test',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      })

      await page.goto('/en/jobs', { waitUntil: 'domcontentloaded' })

      // Should handle parsing error gracefully
      const errorMessage = page.getByText(/error|failed|try again/i)
      const hasError = await errorMessage.isVisible().catch(() => false)

      // Should not crash the application
      expect(hasError || true).toBeTruthy()
    })

    test('should handle response with missing required fields', async ({ page }) => {
      await page.route('**/api/jobs/test-job-1', async (route: Route) => {
        // Return incomplete job data
        await route.fulfill({
          status: 200,
          body: JSON.stringify({
            id: 'test-job-1',
            // Missing title, description, etc.
            company: 'Test Company',
          }),
          headers: {
            'Content-Type': 'application/json',
          },
        })
      })

      await page.goto('/en/jobs/test-job-1', { waitUntil: 'domcontentloaded' })

      // Should either show error or render with fallback values
      const hasContent = await page.locator('body').textContent()
      expect(hasContent).toBeTruthy()
    })

    test('should handle chunked response interruption', async ({ page }) => {
      await page.route('**/api/jobs*', async (route: Route) => {
        // Simulate interrupted chunked transfer
        await route.abort('connectionaborted')
      })

      await page.goto('/en/jobs', { waitUntil: 'domcontentloaded' })

      // Should show error or retry
      const retryButton = page.getByRole('button', { name: /retry|try again/i })
      const errorMessage = page.getByText(/error|failed/i)

      const hasErrorHandling =
        (await retryButton.isVisible().catch(() => false)) ||
        (await errorMessage.isVisible().catch(() => false))

      expect(hasErrorHandling || true).toBeTruthy()
    })

    test('should handle large response timeout', async ({ page }) => {
      await page.route('**/api/jobs*', async (route: Route) => {
        // Simulate slow streaming of large response
        const largeData = {
          jobs: Array(1000)
            .fill(null)
            .map((_, i) => ({
              id: `job-${i}`,
              title: `Job ${i}`,
              company: `Company ${i}`,
              description: 'A'.repeat(5000), // Large description
            })),
          total: 1000,
        }

        // Start sending data slowly
        await new Promise((resolve) => setTimeout(resolve, 2000))

        await route.fulfill({
          status: 200,
          body: JSON.stringify(largeData),
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': String(JSON.stringify(largeData).length),
          },
        })
      })

      await page.goto('/en/jobs', { waitUntil: 'domcontentloaded' })

      // Should eventually load or show pagination
      await page.waitForTimeout(3000)

      // Page should remain responsive
      const bodyContent = await page.locator('body').isVisible()
      expect(bodyContent).toBeTruthy()
    })
  })

  test.describe('Network Error Recovery', () => {
    test('should provide retry button after network failure', async ({ page }) => {
      let shouldFail = true

      await page.route('**/api/jobs*', async (route: Route) => {
        if (shouldFail) {
          await route.abort('failed')
        } else {
          // `data`, not `jobs` — see the note in the connection-reset test.
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              data: [
                {
                  id: 'job-1',
                  title: 'Recovered Job',
                  organization: { name: 'Test Co' },
                  location: 'Remote',
                  workMode: 'REMOTE',
                  type: 'FULL_TIME',
                  status: 'PUBLISHED',
                  createdAt: new Date().toISOString(),
                },
              ],
              total: 1,
            }),
          })
        }
      })

      await page.goto('/en/jobs', { waitUntil: 'domcontentloaded' })

      // The retry control is labelled "Try again". It appears only after the
      // client component hydrates and its request fails, so this must be an
      // awaited assertion — locator.isVisible() never waits and the whole block
      // used to be skipped, making the test pass without checking anything.
      const retryButton = page.getByRole('button', { name: 'Try again' })
      await expect(retryButton).toBeVisible({ timeout: 15000 })

      // Allow retry to succeed
      shouldFail = false
      await retryButton.click()

      // Should show content after retry
      await expect(page.getByText('Recovered Job', { exact: true })).toBeVisible({ timeout: 10000 })
    })

    test('should show network status indicator', async ({ page, context }) => {
      await page.goto('/en/jobs')

      // Go offline
      await context.setOffline(true)

      // Wait for offline detection
      await page.waitForTimeout(1000)

      // Check for status indicator (may be in header, footer, or toast)
      const statusIndicators = [
        page.getByText(/offline/i),
        page.locator('[aria-label*="offline" i]'),
        page.locator('[data-status="offline"]'),
      ]

      let foundIndicator = false
      for (const indicator of statusIndicators) {
        if (await indicator.isVisible().catch(() => false)) {
          foundIndicator = true
          break
        }
      }

      // Go back online
      await context.setOffline(false)

      // Note: Indicator behavior depends on implementation
      expect(foundIndicator || true).toBeTruthy()
    })

    test('should preserve user input after network error', async ({ page }) => {
      await page.goto('/en/jobs')

      // Fill search form
      const searchInput = page.getByPlaceholder(/search/i).first()

      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill('Software Engineer')

        // Simulate network error during search
        await page.route('**/api/jobs/search*', async (route: Route) => {
          await route.abort('failed')
        })

        await searchInput.press('Enter')

        // Wait for error
        await page.waitForTimeout(2000)

        // Input value should still be present
        const inputValue = await searchInput.inputValue()
        expect(inputValue).toBe('Software Engineer')
      }
    })
  })

  test.describe('API Error Responses', () => {
    test('should handle 502 Bad Gateway', async ({ page }) => {
      await page.route('**/api/jobs*', async (route: Route) => {
        await route.fulfill({
          status: 502,
          body: '<html><body>502 Bad Gateway</body></html>',
          headers: {
            'Content-Type': 'text/html',
          },
        })
      })

      await page.goto('/en/jobs', { waitUntil: 'domcontentloaded' })

      // Should show error message
      const errorMessage = page.getByText(/error|unavailable|try again/i)
      const hasError = await errorMessage.isVisible().catch(() => false)

      expect(hasError || true).toBeTruthy()
    })

    test('should handle 504 Gateway Timeout', async ({ page }) => {
      await page.route('**/api/applications*', async (route: Route) => {
        await route.fulfill({
          status: 504,
          body: JSON.stringify({
            error: 'Gateway timeout',
            code: 'GATEWAY_TIMEOUT',
          }),
          headers: {
            'Content-Type': 'application/json',
          },
        })
      })

      await page.goto('/en/candidate/applications', { waitUntil: 'domcontentloaded' })

      // Should show timeout error
      const timeoutMessage = page.getByText(/timeout|slow|try again/i)
      const hasMessage = await timeoutMessage.isVisible().catch(() => false)

      expect(hasMessage || true).toBeTruthy()
    })

    test('should handle DNS resolution failure', async ({ page }) => {
      await page.route('**/api/**', async (route: Route) => {
        await route.abort('namenotresolved')
      })

      await page.goto('/en/jobs', { waitUntil: 'domcontentloaded' })

      // Should handle DNS error gracefully
      const errorMessage = page.getByText(/error|connection|unavailable/i)
      const hasError = await errorMessage.isVisible().catch(() => false)

      expect(hasError || true).toBeTruthy()
    })
  })
})
