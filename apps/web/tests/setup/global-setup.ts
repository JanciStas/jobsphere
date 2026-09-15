/**
 * Playwright Global Setup
 *
 * This script runs once before all tests. It:
 * 1. Seeds the test database with test users for each role
 * 2. Logs in each user via the UI to obtain auth state
 * 3. Saves auth state to files for reuse across all tests
 *
 * This approach dramatically speeds up test execution by avoiding
 * repeated logins in individual tests.
 */

import { chromium, type FullConfig } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs'
import { createAllTestUsers, getUserCredentials, TEST_USERS } from '../helpers/test-users'

/**
 * Refuse to run against anything that is not an obviously local test database.
 *
 * Global setup seeds rows and global teardown deletes them again. Launched
 * without an explicit DATABASE_URL the suite silently inherits whatever the
 * repo's env files point at - which is a real, shared database. Running the
 * suite then means seeding and wiping rows there. This check turns that into a
 * loud refusal instead of a quiet accident: the host must be loopback and the
 * database name must contain "test".
 */
function assertLocalTestDatabase() {
  const raw = process.env.DATABASE_URL
  if (!raw) {
    throw new Error(
      'DATABASE_URL is not set - refusing to run E2E setup without an explicit test database.',
    )
  }

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('DATABASE_URL is not a valid URL - refusing to run E2E setup.')
  }

  const isLoopback = ['localhost', '127.0.0.1', '::1', 'db', 'postgres'].includes(url.hostname)
  const dbName = url.pathname.replace(/^\//, '')
  const looksLikeTestDb = /test/i.test(dbName)

  if (!isLoopback || !looksLikeTestDb) {
    // Never echo the URL itself - it carries credentials.
    throw new Error(
      'Refusing to run E2E global setup: DATABASE_URL must point at a local database whose name ' +
        `contains "test" (got host "${url.hostname}", database "${dbName}"). ` +
        'Export the test DATABASE_URL before running Playwright.',
    )
  }

  console.log(`Using test database "${dbName}" on ${url.hostname}`)
}

const AUTH_DIR = path.join(__dirname, '..', '..', 'playwright', '.auth')

/**
 * Login via UI and save authentication state
 */
async function loginAndSaveAuth(
  baseURL: string,
  userKey: keyof typeof TEST_USERS,
  authFilePath: string,
) {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    const credentials = getUserCredentials(userKey)

    // Navigate to login page
    await page.goto(`${baseURL}/en/login`)

    // Fill in login form
    await page.fill('input[type="email"]', credentials.email)
    await page.fill('input[type="password"]', credentials.password)

    // Submit form
    await page.click('button[type="submit"]')

    // Wait for redirect after successful login
    await page.waitForURL(/\/(en|de|cs|sk|pl)\/(dashboard|employer)/, {
      timeout: 10000,
    })

    // Save authentication state
    await context.storageState({ path: authFilePath })

    console.log(`✓ Saved auth state for ${userKey}`)
  } catch (error) {
    console.error(`✗ Failed to login ${userKey}:`, error)
    throw error
  } finally {
    await context.close()
    await browser.close()
  }
}

/**
 * Main global setup function
 */
async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL || 'http://localhost:3000'

  console.log('\n🔧 Running Playwright global setup...\n')

  // Initialize Prisma client
  assertLocalTestDatabase()

  const prisma = new PrismaClient()

  try {
    // Ensure auth directory exists
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true })
    }

    console.log('📦 Seeding test database with users...')

    // Create all test users in database
    const { users } = await createAllTestUsers(prisma)

    console.log('✓ Test users created:')
    console.log(`  - Candidate: ${users.candidate.email}`)
    console.log(`  - Recruiter: ${users.recruiter.email}`)
    console.log(`  - Org Admin: ${users.orgAdmin.email}`)
    console.log(`  - Hiring Manager: ${users.hiringManager.email}`)
    console.log(`  - Agency: ${users.agency.email}\n`)

    console.log('Test jobs seeded: 3 published jobs owned by Test Org Inc\n')

    console.log('🔐 Logging in users and saving auth states...\n')

    // Login each user and save auth state
    await Promise.all([
      loginAndSaveAuth(baseURL, 'candidate', path.join(AUTH_DIR, 'candidate.json')),
      loginAndSaveAuth(baseURL, 'recruiter', path.join(AUTH_DIR, 'recruiter.json')),
      loginAndSaveAuth(baseURL, 'orgAdmin', path.join(AUTH_DIR, 'orgAdmin.json')),
      loginAndSaveAuth(baseURL, 'hiringManager', path.join(AUTH_DIR, 'hiringManager.json')),
      loginAndSaveAuth(baseURL, 'agency', path.join(AUTH_DIR, 'agency.json')),
      loginAndSaveAuth(baseURL, 'globalAdmin', path.join(AUTH_DIR, 'globalAdmin.json')),
    ])

    console.log('\n✅ Global setup completed successfully!\n')
  } catch (error) {
    console.error('\n❌ Global setup failed:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

export default globalSetup
