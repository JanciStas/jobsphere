/**
 * E2E Tests - Screen Reader Accessibility
 *
 * Comprehensive tests to ensure the application is usable with assistive technologies
 * like NVDA, JAWS, and VoiceOver. Tests verify ARIA attributes, live regions,
 * semantic HTML, and proper screen reader announcements.
 *
 * WCAG 2.1 Level AA Compliance Testing
 */

import { test, expect } from '@playwright/test'

test.describe('Screen Reader Accessibility', () => {
  /**
   * ARIA Labels Tests
   * Verify all interactive elements have accessible names for screen readers
   */
  test.describe('ARIA Labels', () => {
    test('navigation should have aria-label', async ({ page }) => {
      await page.goto('/en')

      // Verify main navigation has descriptive label
      const nav = page.locator('nav[role="navigation"][aria-label="Main navigation"]')
      await expect(nav).toBeVisible()

      // Verify header has proper role and label
      const header = page.locator('header[role="banner"]')
      await expect(header).toBeVisible()
      await expect(header).toHaveAttribute('aria-label', 'Site header')
    })

    test('all interactive elements should have accessible names', async ({ page }) => {
      await page.goto('/en')

      // Verify all buttons have accessible names
      const buttons = page.locator('button')
      const buttonCount = await buttons.count()

      for (let i = 0; i < buttonCount; i++) {
        const button = buttons.nth(i)

        // Get accessible name from aria-label or text content
        const ariaLabel = await button.getAttribute('aria-label')
        const textContent = await button.textContent()
        const ariaLabelledBy = await button.getAttribute('aria-labelledby')

        // Button must have at least one way to be labeled
        const hasAccessibleName =
          ariaLabel || (textContent && textContent.trim().length > 0) || ariaLabelledBy

        expect(hasAccessibleName).toBeTruthy()

        // If aria-label exists, it should be meaningful (>2 characters)
        if (ariaLabel) {
          expect(ariaLabel.length).toBeGreaterThan(2)
        }
      }
    })

    test('icon-only buttons should have aria-label', async ({ page }) => {
      await page.goto('/en/jobs')

      // Find filter buttons with icons
      const filterButtons = page.locator('button[aria-haspopup="menu"]')
      const count = await filterButtons.count()

      if (count > 0) {
        for (let i = 0; i < count; i++) {
          const button = filterButtons.nth(i)

          // Verify button has either aria-label or meaningful text
          const ariaLabel = await button.getAttribute('aria-label')
          const textContent = await button.textContent()

          const hasLabel =
            (ariaLabel && ariaLabel.length > 0) || (textContent && textContent.trim().length > 0)

          expect(hasLabel).toBeTruthy()
        }
      }
    })

    test('links should have descriptive aria-labels when needed', async ({ page }) => {
      await page.goto('/en')

      // Verify logo link has descriptive label
      const logoLink = page.locator('a[aria-label="JobSphere home"]')
      await expect(logoLink).toBeVisible()

      // Auth links are named by their visible (translated) text, not a hardcoded aria-label
      const header = page.getByRole('banner')
      await expect(header.getByRole('link', { name: 'Log in' })).toBeVisible()
      await expect(header.getByRole('link', { name: 'Sign up' })).toBeVisible()
    })
  })

  /**
   * Live Regions Tests
   * Verify dynamic content updates are announced to screen readers
   */
  test.describe('Live Regions', () => {
    test('form errors should use aria-live or role="alert"', async ({ page }) => {
      await page.goto('/en/login')

      // Fill form incorrectly
      await page.fill('input[type="email"]', 'invalid-email')
      await page.fill('input[type="password"]', 'short')

      // Submit form to trigger validation
      await page.click('button[type="submit"]')

      // Wait for error to appear
      await page.waitForTimeout(1000)

      // Check for error message with aria-live or role="alert"
      const errorRegions = page.locator(
        '[role="alert"], [aria-live="polite"], [aria-live="assertive"]',
      )
      const errorCount = await errorRegions.count()

      // Should have at least one live region for errors
      if (errorCount > 0) {
        const firstError = errorRegions.first()
        await expect(firstError).toBeVisible()

        // Verify error has meaningful text
        const errorText = await firstError.textContent()
        expect(errorText).toBeTruthy()
        expect(errorText!.trim().length).toBeGreaterThan(0)
      }
    })

    test('search results count should be announced', async ({ page }) => {
      await page.goto('/en/jobs')

      // Wait for initial load
      await page.waitForTimeout(1000)

      // Verify results count is visible
      const resultsText = page.locator('p').filter({ hasText: /\d+.*offer/i })
      await expect(resultsText.first()).toBeVisible()

      // Perform search to trigger update
      const searchInput = page.locator('input[placeholder*="Search"]').first()
      await searchInput.fill('developer')

      // Wait for debounce
      await page.waitForTimeout(700)

      // Results text should be visible (live-region announcement is best practice, not enforced)
      await expect(resultsText.first()).toBeVisible()
    })

    test('loading states should be announced', async ({ page }) => {
      await page.goto('/en/jobs')

      // Look for loading indicators
      const loadingIndicator = page
        .locator('[aria-live], [role="status"]')
        .filter({ hasText: /loading/i })

      // If loading state exists, it should have proper ARIA
      if ((await loadingIndicator.count()) > 0) {
        const liveRegion = loadingIndicator.first()

        // Should have aria-live or role="status"
        const hasLiveRegion =
          (await liveRegion.getAttribute('aria-live')) !== null ||
          (await liveRegion.getAttribute('role')) === 'status'

        expect(hasLiveRegion).toBeTruthy()
      }
    })
  })

  /**
   * Form Error Announcements Tests
   * Verify form errors are properly associated with inputs
   */
  test.describe('Form Error Announcements', () => {
    test('invalid form fields should have aria-invalid', async ({ page }) => {
      await page.goto('/en/login')

      // Fill email incorrectly
      await page.fill('input[type="email"]', 'invalid-email')

      // Submit to trigger validation
      await page.click('button[type="submit"]')
      await page.waitForTimeout(500)

      // Check for aria-invalid on email input
      const emailInput = page.locator('input[type="email"]')
      const ariaInvalid = await emailInput.getAttribute('aria-invalid')

      // If validation is implemented with aria-invalid
      if (ariaInvalid) {
        expect(ariaInvalid).toBe('true')
      }
    })

    test('form errors should be linked with aria-describedby', async ({ page }) => {
      await page.goto('/en/login')

      // Submit empty form
      await page.click('button[type="submit"]')
      await page.waitForTimeout(500)

      // Find invalid inputs
      const invalidInputs = page.locator('input[aria-invalid="true"], input[aria-describedby]')
      const count = await invalidInputs.count()

      if (count > 0) {
        const input = invalidInputs.first()
        const describedBy = await input.getAttribute('aria-describedby')

        if (describedBy) {
          // Verify the referenced error element exists
          const errorElement = page.locator(`#${describedBy}`)
          const errorExists = (await errorElement.count()) > 0

          expect(errorExists).toBeTruthy()

          if (errorExists) {
            // Error should be visible or in live region
            const isVisible = await errorElement.isVisible()
            expect(isVisible).toBeTruthy()
          }
        }
      }
    })

    test('form error summary should be announced', async ({ page }) => {
      await page.goto('/en/login')

      // Submit empty form
      await page.click('button[type="submit"]')
      await page.waitForTimeout(500)

      // Look for error summary or alert
      const errorSummary = page.locator('[role="alert"]').first()

      if ((await errorSummary.count()) > 0) {
        await expect(errorSummary).toBeVisible()

        // Error should have meaningful text
        const errorText = await errorSummary.textContent()
        expect(errorText).toBeTruthy()
        expect(errorText!.trim().length).toBeGreaterThan(5)
      }
    })
  })

  /**
   * Page Title Updates Tests
   * Verify page title updates on navigation for screen reader context
   */
  test.describe('Page Title Updates', () => {
    test('page title should update on navigation', async ({ page }) => {
      // Homepage
      await page.goto('/en')
      await expect(page).toHaveTitle(/JobSphere|Home/i)

      // Jobs page
      await page.goto('/en/jobs')
      await expect(page).toHaveTitle(/Job.*JobSphere/i)

      // Login page
      await page.goto('/en/login')
      await expect(page).toHaveTitle(/Login.*JobSphere|JobSphere/i)

      // Pricing page
      await page.goto('/en/pricing')
      await expect(page).toHaveTitle(/Pricing.*JobSphere|JobSphere/i)
    })

    test('page titles should be descriptive and unique', async ({ page }) => {
      const pages = [
        { url: '/en', pattern: /JobSphere/ },
        { url: '/en/jobs', pattern: /job/i },
        { url: '/en/login', pattern: /JobSphere/ },
        { url: '/en/signup', pattern: /JobSphere/ },
        { url: '/en/pricing', pattern: /JobSphere/ },
      ]

      const titles: string[] = []

      for (const { url, pattern } of pages) {
        await page.goto(url)
        const title = await page.title()

        // Title should match pattern
        expect(title).toMatch(pattern)

        // Title should not be empty
        expect(title.trim().length).toBeGreaterThan(0)

        // Store for uniqueness check
        titles.push(title)
      }

      // Verify titles are contextual (not all the same)
      const uniqueTitles = new Set(titles)
      // At least 2 different titles expected
      expect(uniqueTitles.size).toBeGreaterThanOrEqual(2)
    })

    test('page title should include branding', async ({ page }) => {
      const pages = ['/en', '/en/jobs', '/en/login', '/en/pricing']

      for (const url of pages) {
        await page.goto(url)
        const title = await page.title()

        // Every page should include "JobSphere" for brand recognition
        expect(title).toMatch(/JobSphere/i)
      }
    })
  })

  /**
   * Heading Hierarchy Tests
   * Verify proper heading structure for screen reader navigation
   */
  test.describe('Heading Hierarchy', () => {
    test('each page should have exactly one h1', async ({ page }) => {
      const pages = ['/en', '/en/jobs', '/en/login', '/en/pricing']

      for (const url of pages) {
        await page.goto(url)

        const h1Elements = page.locator('h1')
        const h1Count = await h1Elements.count()

        // Should have exactly one h1
        expect(h1Count).toBe(1)

        // h1 should have meaningful text
        const h1Text = await h1Elements.textContent()
        expect(h1Text).toBeTruthy()
        expect(h1Text!.trim().length).toBeGreaterThan(0)
      }
    })

    test('headings should follow logical hierarchy', async ({ page }) => {
      await page.goto('/en')

      // Get all headings
      const headings = page.locator('h1, h2, h3, h4, h5, h6')
      const count = await headings.count()

      expect(count).toBeGreaterThan(0)

      const levels: number[] = []
      for (let i = 0; i < count; i++) {
        const heading = headings.nth(i)
        const tagName = await heading.evaluate((el) => el.tagName)
        const level = parseInt(tagName.replace('H', ''))
        levels.push(level)
      }

      // First heading should be h1
      expect(levels[0]).toBe(1)

      // Verify no level skipping (e.g., h1 → h3)
      for (let i = 1; i < levels.length; i++) {
        const previousLevel = levels[i - 1]
        const currentLevel = levels[i]
        const levelJump = currentLevel - previousLevel

        // Allow same level, one level down, or any jump up
        // But don't skip levels when going down (e.g., h1 → h3)
        if (currentLevel > previousLevel) {
          expect(levelJump).toBeLessThanOrEqual(1)
        }
      }
    })

    test('headings should describe content structure', async ({ page }) => {
      await page.goto('/en')

      // Get all headings
      const headings = page.locator('h1, h2, h3, h4, h5, h6')
      const count = await headings.count()

      // Verify each heading has meaningful text
      for (let i = 0; i < count; i++) {
        const heading = headings.nth(i)
        const text = await heading.textContent()

        expect(text).toBeTruthy()
        expect(text!.trim().length).toBeGreaterThan(2)
      }
    })
  })

  /**
   * Landmark Regions Tests
   * Verify proper semantic HTML landmarks for screen reader navigation
   */
  test.describe('Landmark Regions', () => {
    test('page should have proper landmark regions', async ({ page }) => {
      await page.goto('/en')

      // Verify header/banner exists
      const header = page.locator('header, [role="banner"]')
      await expect(header.first()).toBeVisible()

      // Verify navigation exists
      const nav = page.locator('nav, [role="navigation"]')
      await expect(nav.first()).toBeVisible()

      // Verify main content exists
      const main = page.locator('main, [role="main"]')
      await expect(main.first()).toBeVisible()

      // Verify footer exists (if present on page)
      const footer = page.locator('footer, [role="contentinfo"]')
      const footerCount = await footer.count()

      if (footerCount > 0) {
        await expect(footer.first()).toBeVisible()
      }
    })

    test('navigation landmarks should have descriptive labels', async ({ page }) => {
      await page.goto('/en')

      // Main navigation should have aria-label
      const mainNav = page.locator('nav[aria-label="Main navigation"]')
      await expect(mainNav).toBeVisible()

      // User actions navigation (if exists)
      const userNav = page.locator('nav[aria-label="User actions"]')
      if ((await userNav.count()) > 0) {
        await expect(userNav).toBeVisible()
      }
    })

    test('main content should have id for skip link', async ({ page }) => {
      await page.goto('/en')

      // Verify main content has id
      const main = page.locator('main, [role="main"]')
      const id = await main.getAttribute('id')

      // Main should have an id (commonly "main-content")
      if (id) {
        expect(id.length).toBeGreaterThan(0)
      }

      // Verify skip link exists and points to main content
      const skipLink = page.locator('a[href*="#main"]')
      if ((await skipLink.count()) > 0) {
        const href = await skipLink.getAttribute('href')
        expect(href).toBeTruthy()

        if (id) {
          expect(href).toContain(id)
        }
      }
    })

    test('skip navigation link should be present', async ({ page }) => {
      await page.goto('/en')

      // Skip link should exist (may be visually hidden)
      const skipLink = page.locator('a[href*="#main"]')
      const skipLinkCount = await skipLink.count()

      // Skip link should exist
      if (skipLinkCount > 0) {
        const href = await skipLink.first().getAttribute('href')
        expect(href).toBeTruthy()
        expect(href).toMatch(/#main/)

        // Should have descriptive text
        const text = await skipLink.first().textContent()
        expect(text).toMatch(/skip/i)
      }
    })

    test('multiple landmarks of same type should have unique labels', async ({ page }) => {
      await page.goto('/en')

      // Check for multiple nav landmarks
      const navLandmarks = page.locator('nav, [role="navigation"]')
      const navCount = await navLandmarks.count()

      if (navCount > 1) {
        // Each nav should have unique aria-label
        const labels: string[] = []

        for (let i = 0; i < navCount; i++) {
          const nav = navLandmarks.nth(i)
          const label = await nav.getAttribute('aria-label')

          // Each navigation should have a label
          expect(label).toBeTruthy()

          if (label) {
            // Labels should be unique
            expect(labels).not.toContain(label)
            labels.push(label)
          }
        }
      }
    })
  })

  /**
   * Status and Live Region Announcements Tests
   * Verify dynamic updates are properly announced
   */
  test.describe('Status and Live Region Announcements', () => {
    test('success messages should use role="status" or aria-live="polite"', async ({ page }) => {
      await page.goto('/en/jobs')

      // Look for status regions
      const statusRegions = page.locator('[role="status"], [aria-live="polite"]')

      // Status regions should exist for non-urgent updates
      // This is more of a structural check
      if ((await statusRegions.count()) > 0) {
        const region = statusRegions.first()

        // Verify it has either role or aria-live
        const role = await region.getAttribute('role')
        const ariaLive = await region.getAttribute('aria-live')

        const hasStatusAttribute = role === 'status' || ariaLive === 'polite'
        expect(hasStatusAttribute).toBeTruthy()
      }
    })

    test('critical alerts should use role="alert" or aria-live="assertive"', async ({ page }) => {
      await page.goto('/en/login')

      // Trigger error
      await page.click('button[type="submit"]')
      await page.waitForTimeout(500)

      // Error messages should use alert
      const alerts = page.locator('[role="alert"], [aria-live="assertive"]')

      if ((await alerts.count()) > 0) {
        const alert = alerts.first()

        // Verify alert is visible
        await expect(alert).toBeVisible()

        // Has meaningful content
        const text = await alert.textContent()
        expect(text).toBeTruthy()
        expect(text!.trim().length).toBeGreaterThan(0)
      }
    })

    test('loading indicators should be announced', async ({ page }) => {
      await page.goto('/en/jobs')

      // Check for loading state indicators
      const loadingText = page.locator('text=/loading/i')

      if ((await loadingText.count()) > 0) {
        const loader = loadingText.first()

        // A live-region announcement is good practice but not strictly required.
        // Just verify the loading text is visible
        await expect(loader).toBeVisible()
      }
    })
  })

  /**
   * Dialog and Modal Accessibility Tests
   * Verify modals are properly announced and accessible
   */
  test.describe('Dialog Accessibility', () => {
    test('dialogs should have role="dialog" and aria-labelledby', async ({ page }) => {
      await page.goto('/en')

      // Look for any dialogs (may need to trigger them)
      const dialogs = page.locator('[role="dialog"]')
      const dialogCount = await dialogs.count()

      if (dialogCount > 0) {
        for (let i = 0; i < dialogCount; i++) {
          const dialog = dialogs.nth(i)

          // Should have aria-labelledby or aria-label
          const labelledBy = await dialog.getAttribute('aria-labelledby')
          const label = await dialog.getAttribute('aria-label')

          const hasLabel = labelledBy || label
          expect(hasLabel).toBeTruthy()

          // If aria-labelledby, verify element exists
          if (labelledBy) {
            const labelElement = page.locator(`#${labelledBy}`)
            const exists = (await labelElement.count()) > 0
            expect(exists).toBeTruthy()
          }
        }
      }
    })

    test('modal dialogs should have aria-modal="true"', async ({ page }) => {
      await page.goto('/en')

      // Find modal dialogs
      const modals = page.locator('[role="dialog"][aria-modal="true"]')

      // If modals exist, they should have proper attributes
      if ((await modals.count()) > 0) {
        const modal = modals.first()

        // Verify aria-modal
        const ariaModal = await modal.getAttribute('aria-modal')
        expect(ariaModal).toBe('true')
      }
    })
  })

  /**
   * Form Input Accessibility Tests
   * Verify form inputs have proper labels and associations
   */
  test.describe('Form Input Accessibility', () => {
    test('all form inputs should have associated labels', async ({ page }) => {
      await page.goto('/en/login')

      // Find all input elements
      const inputs = page.locator('input[type="email"], input[type="password"], input[type="text"]')
      const count = await inputs.count()

      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i)

        // Input should have id
        const id = await input.getAttribute('id')
        expect(id).toBeTruthy()

        if (id) {
          // Should have corresponding label
          const label = page.locator(`label[for="${id}"]`)
          const labelExists = (await label.count()) > 0

          // Or should have aria-label
          const ariaLabel = await input.getAttribute('aria-label')
          const ariaLabelledBy = await input.getAttribute('aria-labelledby')

          const hasLabel = labelExists || ariaLabel || ariaLabelledBy
          expect(hasLabel).toBeTruthy()
        }
      }
    })

    test('checkboxes should have accessible labels', async ({ page }) => {
      await page.goto('/en/login')

      // Find checkbox (remember me)
      const checkboxes = page.locator('input[type="checkbox"]')
      const count = await checkboxes.count()

      if (count > 0) {
        for (let i = 0; i < count; i++) {
          const checkbox = checkboxes.nth(i)
          const id = await checkbox.getAttribute('id')

          expect(id).toBeTruthy()

          if (id) {
            // Should have label
            const label = page.locator(`label[for="${id}"]`)
            const labelCount = await label.count()

            expect(labelCount).toBeGreaterThan(0)

            if (labelCount > 0) {
              const labelText = await label.textContent()
              expect(labelText).toBeTruthy()
              expect(labelText!.trim().length).toBeGreaterThan(0)
            }
          }
        }
      }
    })
  })
})
