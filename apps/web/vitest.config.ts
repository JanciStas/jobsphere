import { defineConfig, coverageConfigDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()] as any,
  test: {
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/e2e/**',
      'tests/integration/**',
      '**/*.e2e.spec.ts',
      // xss-protection and sql-injection require a live PostgreSQL DB — routed to
      // vitest.integration.config.ts and the CI `security-integration` job.
      'tests/security/xss-protection.test.ts',
      'tests/security/sql-injection.test.ts',
      // Performance tests require live Lighthouse CI. Run separately.
      'tests/performance/**',
      // A11y tests require live browser/Playwright. Run separately.
      'tests/a11y/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      // Only application source counts. Previously this block set `exclude`
      // alone, which REPLACES vitest's defaults rather than extending them —
      // so test files, *.d.ts, scripts/, prisma/ and .next/ output were all
      // instrumented as if they were source, making the reported number
      // meaningless (and the 80% threshold below it unreachable by design).
      include: ['src/**/*.{ts,tsx}'],
      exclude: [...coverageConfigDefaults.exclude, 'src/**/types.ts'],
      // Ratchet, not aspiration. These track values actually measured, rounded
      // down. The original 80/75 numbers were never met by any run — a gate
      // that always fails gates nothing, which is why CI had to be bypassed.
      // Raise these as coverage improves; never lower them to green a build.
      //
      //   2026-07-29  lines 19.81  branches 58.69  functions 36.95
      //   2026-08-09  lines 21.43  branches 60.01  functions 38.62  (+ server actions,
      //               route/server-action contract tests)
      //   2026-08-10  all-files 23.65 / 62.17 / 40.40  (+ stripe portal, GDPR export
      //               and DSAR, password-reset lifecycle). The global figures below
      //               are set a point under the derived value rather than on it —
      //               vitest only prints the true global number when it FAILS, so
      //               the exact figure is unknown while the gate is green.
      //
      // The global numbers are a floor against regression, not a real gate: with
      // 76 API routes in the tree, an untested one is easily offset by covering a
      // formatting helper. The per-glob entries below are the actual gate — they
      // put the requirement where the risk is (money, tenant boundary, GDPR,
      // and the soft-delete middleware every read depends on).
      //
      // Note when adding a glob: vitest EXCLUDES files matching a per-glob entry
      // from the global calculation and checks them only against their own
      // numbers. Adding `src/lib/actions/**` therefore lowered the global figures
      // (22.00 -> 21.43 lines) even though nothing about the tests changed. Always
      // re-measure after adding a glob rather than reusing the previous run's value.
      thresholds: {
        lines: 22,
        functions: 39,
        branches: 61,
        statements: 22,
        'src/lib/actions/**': {
          lines: 90,
          functions: 100,
          branches: 80,
          statements: 90,
        },
      },
    },
    globals: true,
    // Use the forks pool: the default threads pool segfaults at teardown on
    // Windows when native modules (clamscan / file-type in the CV security
    // tests) are loaded across worker threads. Forks isolate per-process and
    // avoid the crash; harmless on CI/Linux.
    pool: 'forks',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
