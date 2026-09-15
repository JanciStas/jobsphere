/**
 * E2E Tests - Authentication Flow
 *
 * Every navigation here is explicitly locale-prefixed with `/en`. The app's
 * default locale is `sk` (see `defaultLocale` in src/config/i18n.ts), so a bare
 * `/signup` is redirected to `/sk/signup` and renders Slovak copy — which is why
 * this whole file used to fail on English text assertions.
 */

import { test, expect } from '@playwright/test'

test.describe('Authentication', () => {
  test('should display homepage', async ({ page }) => {
    await page.goto('/en')

    // The homepage lives in the same route segment as the layout that declares
    // `title.template`, and Next only applies that template to *child* segments —
    // so this page's title is the bare hero title, with no "| JobSphere" suffix.
    await expect(page).toHaveTitle(/Find Your Dream Job/i)
    await expect(page.getByRole('heading', { name: /Find Your Dream Job/i })).toBeVisible()
  })

  test('should navigate to pricing page', async ({ page }) => {
    await page.goto('/en')

    // "Pricing" is linked three times (desktop nav, mobile drawer, footer). They
    // all point at the same route, so taking the header's is unambiguous.
    await page
      .getByRole('banner')
      .getByRole('link', { name: /Pricing/i })
      .first()
      .click()

    await expect(page).toHaveURL(/\/pricing/)
    await expect(page.getByRole('heading', { name: 'Pricing', exact: true })).toBeVisible()
  })

  test('should show signup form', async ({ page }) => {
    await page.goto('/en/signup')

    // getByLabel(/password/i) matches four things on this page: the password and
    // confirm-password inputs plus both show/hide toggle buttons, which carry the
    // field name as their aria-label. Address the inputs directly instead.
    await expect(page.locator('input#email')).toBeVisible()
    await expect(page.locator('input#password')).toBeVisible()
    await expect(page.locator('input#confirmPassword')).toBeVisible()
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible()
  })

  test('should show login form', async ({ page }) => {
    await page.goto('/en/login')

    await expect(page.locator('input#email')).toBeVisible()
    await expect(page.locator('input#password')).toBeVisible()
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible()
  })

  test('should reject a malformed email on signup', async ({ page }) => {
    await page.goto('/en/signup')

    await page.locator('input#email').fill('invalid-email')
    await page.locator('input#password').fill('password123')
    await page.getByRole('button', { name: /create account/i }).click()

    // Signup validates the email with the native constraint on `input[type=email]`
    // — there is no in-DOM "invalid email" message to assert on. What the app
    // guarantees is that the form does not submit, so assert exactly that.
    const emailValid = await page
      .locator('input#email')
      .evaluate((el: HTMLInputElement) => el.validity.valid)
    expect(emailValid).toBe(false)
    await expect(page).toHaveURL(/\/en\/signup/)
  })

  test('should require password on signup', async ({ page }) => {
    await page.goto('/en/signup')

    await page.locator('input#email').fill('test@example.com')
    await page.getByRole('button', { name: /create account/i }).click()

    // Same story: the password input is `required`, so the browser blocks submit.
    const passwordValid = await page
      .locator('input#password')
      .evaluate((el: HTMLInputElement) => el.validity.valid)
    expect(passwordValid).toBe(false)
    await expect(page).toHaveURL(/\/en\/signup/)
  })

  test('should reject a password shorter than the 12 character minimum', async ({ page }) => {
    await page.goto('/en/signup')

    await page.locator('input#name').fill('Short Password User')
    await page.locator('input#email').fill('short-password@example.com')
    await page.locator('input#password').fill('short')
    await page.locator('input#confirmPassword').fill('short')
    await page.getByRole('button', { name: /create account/i }).click()

    const passwordValid = await page
      .locator('input#password')
      .evaluate((el: HTMLInputElement) => el.validity.valid)
    expect(passwordValid).toBe(false)
    await expect(page).toHaveURL(/\/en\/signup/)
  })
})
