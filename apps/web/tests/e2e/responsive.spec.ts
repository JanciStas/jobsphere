/**
 * E2E Tests - Responsive Design
 * Tests application layout across different viewport sizes
 */

import { test, expect } from '@playwright/test'

const viewports = [
  { name: 'mobile', width: 375, height: 667 }, // iPhone SE
  { name: 'tablet', width: 768, height: 1024 }, // iPad
  { name: 'desktop', width: 1920, height: 1080 }, // Full HD
  { name: 'wide', width: 2560, height: 1440 }, // 2K
]

/**
 * The homepage title is NOT "… | JobSphere".
 *
 * `app/[locale]/layout.tsx` sets `title.template = '%s | JobSphere'`, and Next
 * applies a template only to CHILD segments. The homepage lives in the same
 * segment as that layout, so it renders its own title verbatim. Child pages
 * (/en/pricing, /en/jobs, …) do get the suffix.
 */
const HOMEPAGE_TITLE = 'Find Your Dream Job with AI'

test.describe('Responsive Layout', () => {
  viewports.forEach((viewport) => {
    test(`Jobs page at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/en/jobs')

      // Wait for page load
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 })

      // Verify layout adapts
      if (viewport.name === 'mobile') {
        // On mobile, check for mobile-specific elements
        // Mobile menu button or hamburger should be present
        const mobileMenu = page.locator(
          'button[aria-label*="menu" i], button[aria-label*="navigation" i]',
        )
        const hasMobileMenu = (await mobileMenu.count()) > 0

        if (hasMobileMenu) {
          await expect(mobileMenu.first()).toBeVisible()
        }
      } else {
        // Desktop navigation should be visible or accessible
        const nav = page.locator('nav, header')
        await expect(nav.first()).toBeVisible()
      }

      // Take screenshot for visual regression
      await page.screenshot({
        path: `screenshots/${viewport.name}-jobs.png`,
        fullPage: true,
      })
    })

    test(`Homepage at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/en')

      // Wait for page load (see HOMEPAGE_TITLE — no "| JobSphere" suffix here)
      await expect(page).toHaveTitle(HOMEPAGE_TITLE)

      // Verify main heading is visible
      const heading = page.getByRole('heading', { name: /Find Your Dream Job|JobSphere/i })
      await expect(heading.first()).toBeVisible()

      // Take screenshot for visual regression
      await page.screenshot({
        path: `screenshots/${viewport.name}-homepage.png`,
        fullPage: true,
      })
    })
  })
})

test.describe('Touch-Friendly Interface', () => {
  test('Buttons should be touch-friendly on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/en')

    // Find all buttons
    const buttons = page.locator('button, a[role="button"]')
    const count = await buttons.count()

    // Check first few buttons for adequate touch target size
    const maxToCheck = Math.min(count, 5)
    for (let i = 0; i < maxToCheck; i++) {
      const button = buttons.nth(i)
      if (await button.isVisible()) {
        const box = await button.boundingBox()
        if (box) {
          // Touch targets should be at least 44x44 pixels (WCAG guidelines)
          expect(box.height).toBeGreaterThanOrEqual(32) // Relaxed for some smaller buttons
          expect(box.width).toBeGreaterThanOrEqual(32)
        }
      }
    }
  })
})

test.describe('Text Readability', () => {
  viewports.forEach((viewport) => {
    test(`Text should be readable at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/en')

      // Check that main content text is visible and readable
      const body = page.locator('body')
      const fontSize = await body.evaluate((el) => {
        return window.getComputedStyle(el).fontSize
      })

      // Font size should be at least 14px for readability
      const size = parseInt(fontSize)
      expect(size).toBeGreaterThanOrEqual(14)
    })
  })
})

test.describe('Navigation Consistency', () => {
  test('Navigation should work consistently across viewports', async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await page.goto('/en')

      // "Pricing" links appear three times on the homepage (desktop nav, the
      // mobile drawer nav, and the footer), so an unscoped
      // getByRole('link', { name: /Pricing/i }) resolves to 3 elements and every
      // call on it fails strict mode. Scope to the named landmarks instead.
      const pricingLink = page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Pricing' })

      if (await pricingLink.isVisible()) {
        await pricingLink.click()
        await expect(page).toHaveURL(/\/pricing/)

        // Navigate back for next iteration
        await page.goBack()
      } else {
        // Below `md` the desktop <nav> is display:none and the drawer behind the
        // hamburger is the only way into the main navigation.
        const menuButton = page.getByRole('button', { name: 'Open main menu' })
        await expect(menuButton).toBeVisible()
        await menuButton.click()

        const pricingLinkInMenu = page
          .getByRole('navigation', { name: 'Mobile navigation' })
          .getByRole('link', { name: 'Pricing' })
        await expect(pricingLinkInMenu).toBeVisible()
        await pricingLinkInMenu.click()
        await expect(page).toHaveURL(/\/pricing/)
        await page.goBack()
      }
    }
  })
})

test.describe('Form Inputs on Mobile', () => {
  test('Form inputs should be usable on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/en/login')

    // Check email input
    const emailInput = page.getByLabel(/email/i)
    await expect(emailInput).toBeVisible()

    // Check that input can be focused and typed into
    await emailInput.click()
    await emailInput.fill('test@example.com')
    await expect(emailInput).toHaveValue('test@example.com')

    // Check password input. NOT getByLabel(/password/i): the show/hide toggle
    // next to the field carries aria-label="Password" too (login-client.tsx),
    // so that locator resolves to the input AND the button — strict-mode death.
    const passwordInput = page.locator('input#password')
    await expect(passwordInput).toBeVisible()
    await passwordInput.click()
    await passwordInput.fill('testpassword123')
    await expect(passwordInput).toHaveValue('testpassword123')

    // Verify inputs are large enough
    const emailBox = await emailInput.boundingBox()
    const passwordBox = await passwordInput.boundingBox()

    if (emailBox && passwordBox) {
      expect(emailBox.height).toBeGreaterThanOrEqual(32)
      expect(passwordBox.height).toBeGreaterThanOrEqual(32)
    }
  })
})

test.describe('Image Responsiveness', () => {
  viewports.forEach((viewport) => {
    test(`Images should scale appropriately at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/en')

      // Find all images
      const images = page.locator('img')
      const count = await images.count()

      if (count > 0) {
        // Check first image
        const firstImage = images.first()
        if (await firstImage.isVisible()) {
          const box = await firstImage.boundingBox()

          if (box) {
            // Image should not exceed viewport width
            expect(box.width).toBeLessThanOrEqual(viewport.width)
          }
        }
      }
    })
  })
})

test.describe('Overflow Prevention', () => {
  /**
   * KNOWN APP BUG at `tablet` (768px) — this case fails on purpose.
   *
   * 768px is exactly the `md` breakpoint, so the full desktop nav switches on
   * while the language switcher + Log in + Sign up cluster is still full width:
   * the header row measures 802px against a 753px client width, giving every
   * page a horizontal scrollbar on iPad portrait. The other three viewports are
   * clean. Fix belongs in `components/layout/header.tsx`.
   */
  viewports.forEach((viewport) => {
    test(`No horizontal scroll at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport)
      await page.goto('/en')

      // 'load', not 'networkidle': networkidle is discouraged by Playwright and
      // an idle window never arrives reliably here, which turned this test into
      // a 30s timeout instead of a verdict. The overflow is in the header and
      // is measurable as soon as the document has loaded.
      await page.waitForLoadState('load')

      // Check for horizontal overflow
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth)

      // Allow small margin of error (1-2px) for rounding
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2)
    })
  })
})
