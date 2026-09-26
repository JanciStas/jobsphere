import { defineConfig, devices } from '@playwright/test'

/**
 * Default E2E config — the smoke run that gates every PR.
 *
 * It used to declare all ten browser projects, which made it unrunnable in CI:
 * the workflow installs only chromium, so firefox/webkit/msedge and every mobile
 * and tablet project (all WebKit- or Edge-backed) died with
 * "browserType.launch: Executable doesn't exist". Not a flake — a certainty, on
 * every run. The other nine projects now live in playwright.cross-browser.config.ts
 * and run on their own schedule.
 *
 * See also PLAYWRIGHT.md for how the four configs relate.
 */
export default defineConfig({
  // Scoped to e2e only. Previously './tests', which swept in tests/a11y/** —
  // 92 accessibility tests running once per project, under this file's 30s
  // timeout instead of the 60s their own config gives them.
  testDir: './tests/e2e',
  testMatch: ['**/*.spec.ts', '**/*.e2e.ts'],
  // Visual-regression specs run via their own opt-in config (playwright.visual.config.ts)
  // so missing baselines never fail the default e2e run.
  testIgnore: ['**/visual/**'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',

  // Global setup and teardown
  globalSetup: require.resolve('./tests/setup/global-setup'),
  globalTeardown: require.resolve('./tests/setup/global-teardown'),

  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Default timeout for actions (e.g., click, fill)
    actionTimeout: 10000,
    // Default timeout for navigation
    navigationTimeout: 30000,
  },

  timeout: 30 * 1000, // 30 seconds per test
  expect: {
    timeout: 5000, // 5 seconds for assertions
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    // In CI, serve the production build. The workflows run `yarn build` and then
    // this command threw that build away by starting `next dev`, so CI spent the
    // build time and still tested a development bundle — different chunking,
    // different error overlays, no minification.
    command: process.env.CI ? 'yarn start' : 'yarn dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    // Playwright's default is 60s. A cold Next start in CI regularly exceeds it,
    // and the resulting "Timed out waiting from config.webServer" reads like an
    // application failure rather than a budget that was simply too small.
    timeout: 300 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
    // Merged over process.env. The specs that upload CVs and search candidates need
    // local file storage (no Vercel Blob token) and a deterministic embedding
    // (no OpenAI key) — without these they failed for environment reasons.
    env: {
      STORAGE_PROVIDER: 'local',
      ENABLE_ANTIVIRUS: 'false',
      E2E_STUB_EMBEDDINGS: '1',
    },
  },
})
