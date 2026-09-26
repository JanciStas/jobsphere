import { PrismaClient } from '@prisma/client'
import { logger } from './logger'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    // Connection pooling configuration
    // Default pool size from Prisma is 10, which is too low for production
    // Recommended: 20-30 connections for production workloads
    // Set via DATABASE_URL: ?connection_limit=25
    // See: apps/web/src/lib/CONNECTION_POOLING.md
  })

// UserOrgRole is soft-deleted when a member is removed from an org. It was missing
// here, so a removed member kept resolving as a member on every lookup that did
// not filter `deletedAt` by hand (see requireOrgAuth and the NextAuth jwt callback).
const MODELS_WITH_SOFT_DELETE = [
  'Job',
  'Organization',
  'User',
  'Candidate',
  'Application',
  'UserOrgRole',
]

/**
 * Read operations that accept a free-form `where` and therefore can be filtered.
 *
 * `groupBy` and `aggregate` are here because they were not before, and their
 * absence was visible to users: seven call sites (dashboard/stats, the employer
 * analytics, applicants and pipeline pages, application.service and job.service)
 * counted soft-deleted applications into the totals shown on screen, so a
 * recruiter who withdrew a candidate still saw them in the stage tallies.
 *
 * `findUnique` is deliberately NOT here and cannot be: its `where` only accepts
 * unique fields, so injecting `deletedAt` would make Prisma reject the query.
 * Call sites that must exclude deleted rows have to use `findFirst` instead —
 * see requireJobWriteAccess in lib/actions/jobs.ts for the case where that
 * distinction let a deleted job be resurrected.
 */
const FILTERABLE_READ_ACTIONS = [
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'groupBy',
  'aggregate',
]

// Soft delete middleware — hides soft-deleted rows from ordinary reads.
prisma.$use(async (params, next) => {
  if (
    MODELS_WITH_SOFT_DELETE.includes(params.model ?? '') &&
    FILTERABLE_READ_ACTIONS.includes(params.action)
  ) {
    params.args = params.args || {}
    // Spread order is load-bearing: the caller's `deletedAt` intentionally wins.
    // This is the documented escape hatch for the code whose whole job is to look
    // at deleted rows — the GDPR retention phase in lib/cron.ts queries
    // `deletedAt: { not: null, lte: cutoff }` to find candidates past their
    // erasure window. Reversing this to force `deletedAt: null` would make that
    // query match nothing, and the Article 17 erasure job would report success
    // while deleting nobody.
    //
    // The cost of the escape hatch is that it is silent: a caller that passes
    // `deletedAt` by accident opts out without saying so. Any new use belongs
    // in the list above this comment, with a reason.
    params.args.where = { deletedAt: null, ...params.args.where }
  }
  return next(params)
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Graceful shutdown: disconnect Prisma on process termination
// This ensures all connections are properly closed before shutdown
if (process.env.NODE_ENV === 'production') {
  const shutdown = async () => {
    logger.info('Shutting down Prisma Client...')
    await prisma.$disconnect()
    logger.info('Prisma Client disconnected')
    process.exit(0)
  }

  // Handle different shutdown signals
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  process.on('SIGHUP', shutdown)
}
