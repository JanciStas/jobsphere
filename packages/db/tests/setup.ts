import { beforeAll, afterAll, beforeEach } from 'vitest'
import { exec } from 'child_process'
import { promisify } from 'util'
import { prisma } from '../src'

const execAsync = promisify(exec)

beforeAll(async () => {
  // Set test environment
  process.env.NODE_ENV = 'test'
  // Keep a caller-supplied local test URL (CI service container, docker-compose.test
  // on :5433); fall back to the historical default otherwise.
  process.env.DATABASE_URL ||= 'postgresql://test:test@localhost:5432/jobsphere_test'

  // Run migrations. This repo is yarn — `pnpm` here made the whole suite fail
  // with "This project is configured to use yarn" on any machine that had a DB.
  await execAsync('yarn prisma migrate deploy')

  console.log('✅ Test database initialized')
})

beforeEach(async () => {
  // Clean database before each test
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname='public'
  `

  for (const { tablename } of tables) {
    if (tablename !== '_prisma_migrations') {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" CASCADE`)
    }
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})
