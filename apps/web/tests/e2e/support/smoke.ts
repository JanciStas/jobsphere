/**
 * Reusable page-smoke + a11y + redirect helpers for the "all pages" E2E suite.
 *
 * NOTE: these run against a live app (Playwright webServer + seeded DB). They
 * are intentionally resilient — a page is "OK" if it renders a landmark, does
 * not hit a 5xx / Next error boundary, and emits no fatal console errors.
 */

import { expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { withLocale, type RouteDef } from './routes'

/** Console/page errors we tolerate (3rd-party, analytics, network noise). */
const IGNORED_CONSOLE = [
  /Failed to load resource/i,
  /favicon/i,
  /\[next-auth\]/i,
  /net::ERR_/i,
  /Download the React DevTools/i,
  // `<Analytics />` from @vercel/analytics (apps/web/src/app/[locale]/layout.tsx)
  // injects <script src="/_vercel/insights/script.js">. That path only exists on
  // Vercel's edge; locally and in CI it falls through to the Next.js catch-all and
  // 404s with the app's HTML shell, so Chrome refuses it on strict MIME checking
  // and EVERY page logs the error below. Third-party analytics noise, not an app
  // bug — matched narrowly on this one script so a genuine CSP/MIME regression on
  // any other script still fails the smoke.
  /Refused to execute script from '[^']*\/_vercel\/insights\/script\.js'/i,
]

/** Attach console + pageerror listeners; returns the collected error strings. */
export function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/**
 * Smoke a single page: navigates, asserts no 5xx, a visible landmark, no Next
 * error boundary, and no fatal console errors.
 */
export async function smokePage(page: Page, route: RouteDef, locale = 'en'): Promise<void> {
  const errors = trackConsoleErrors(page)
  const resp = await page.goto(withLocale(route.path, locale), { waitUntil: 'domcontentloaded' })

  if (resp) {
    expect(resp.status(), `HTTP status for ${route.path}`).toBeLessThan(500)
  }

  await expect(page.locator('body')).toBeVisible()
  await expect(
    page.locator('main, h1, [role="main"]').first(),
    `visible landmark on ${route.path}`,
  ).toBeVisible({ timeout: 15000 })

  await expect(
    page.getByText(/Application error|Internal Server Error|This page could not be found/i),
    `no error boundary on ${route.path}`,
  ).toHaveCount(0)

  const fatal = errors.filter((e) => !IGNORED_CONSOLE.some((re) => re.test(e)))
  expect(fatal, `console errors on ${route.path}:\n${fatal.join('\n')}`).toHaveLength(0)
}

/**
 * axe-core a11y scan — fails only on `serious`/`critical` violations (WCAG 2 A/AA).
 * Pragmatic bar so the suite is actionable, not perpetually red on minor issues.
 */
export async function a11yScan(page: Page, opts: { disableRules?: string[] } = {}): Promise<void> {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa'])
  if (opts.disableRules?.length) builder.disableRules(opts.disableRules)
  const results = await builder.analyze()
  const seriousOrWorse = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  )
  const report = seriousOrWorse.map((v) => `- ${v.id} (${v.impact}): ${v.help}`).join('\n')
  expect(seriousOrWorse, `a11y violations:\n${report}`).toHaveLength(0)
}

/** Assert visiting a path redirects to the login page (unauth / insufficient role). */
export async function expectLoginRedirect(page: Page, path: string, locale = 'en'): Promise<void> {
  await page.goto(withLocale(path, locale), { waitUntil: 'domcontentloaded' })
  await expect(page, `${path} should redirect to /login`).toHaveURL(/\/login/, { timeout: 15000 })
}
