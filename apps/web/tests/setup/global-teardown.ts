/**
 * Playwright Global Teardown
 *
 * This script runs once after all tests complete. It:
 * 1. Cleans up test users and organization from database
 * 2. Removes saved authentication state files
 *
 * This ensures a clean state for the next test run and prevents
 * test data from accumulating in the database.
 */

import { PrismaClient } from '@prisma/client'
import path from 'path'
import fs from 'fs'
import { cleanupTestData } from '../helpers/test-users'

const AUTH_DIR = path.join(__dirname, '..', '..', 'playwright', '.auth')

/**
 * Main global teardown function
 */
async function globalTeardown() {
  console.log('\n🧹 Running Playwright global teardown...\n')

  const prisma = new PrismaClient()

  try {
    console.log('🗑️  Cleaning up test database...')

    // Clean up test users and organization
    await cleanupTestData(prisma)

    console.log('✓ Test data removed from database')

    // Remove authentication state files
    if (fs.existsSync(AUTH_DIR)) {
      const authFiles = [
        'candidate.json',
        'recruiter.json',
        'orgAdmin.json',
        'hiringManager.json',
        'agency.json',
        'globalAdmin.json',
      ]

      for (const file of authFiles) {
        const filePath = path.join(AUTH_DIR, file)
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      }

      console.log('✓ Authentication state files removed')
    }

    console.log('\n✅ Global teardown completed successfully!\n')
  } catch (error) {
    console.error('\n❌ Global teardown failed:', error)
    // Don't throw - we want tests to complete even if cleanup fails
  } finally {
    await prisma.$disconnect()
  }
}

export default globalTeardown
