'use server'

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { addEmbeddingJob, addMatchScoreCacheJob } from '@/lib/queue'
import { logger } from '@/lib/logger'
import type { Job } from '@prisma/client'

export async function createJob(formData: {
  title: string
  location: string
  minSalary?: string
  maxSalary?: string
  workMode: string
  type: string
  seniority: string
  description: string
  orgId: string
}): Promise<Job> {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  // Membership AND role, matching POST /api/jobs — see JOB_WRITE_ROLES below.
  const membership = await prisma.userOrgRole.findFirst({
    where: {
      userId: session.user.id,
      orgId: formData.orgId,
      deletedAt: null,
    },
  })

  if (!membership) {
    throw new Error('You are not a member of this organization')
  }

  if (!JOB_WRITE_ROLES.includes(membership.role)) {
    throw new Error('Forbidden')
  }

  const job = await prisma.job.create({
    data: {
      title: formData.title,
      city: formData.location || null,
      region: null,
      remote: formData.workMode === 'REMOTE',
      hybrid: formData.workMode === 'HYBRID',
      salaryMin: formData.minSalary ? parseInt(formData.minSalary) : null,
      salaryMax: formData.maxSalary ? parseInt(formData.maxSalary) : null,
      employmentType: formData.type,
      seniority: formData.seniority,
      description: formData.description,
      orgId: formData.orgId,
      status: 'PUBLISHED',
      createdBy: session.user.id,
    },
  })

  // Async embedding generation (non-blocking)
  addEmbeddingJob({ jobId: job.id }).catch((err) => {
    logger.error('Failed to queue job embedding', { error: err, jobId: job.id })
    // Don't throw - embedding is nice-to-have, not critical
  })

  // Async match score caching for popular jobs (non-blocking)
  addMatchScoreCacheJob({ jobId: job.id }).catch((err) => {
    logger.error('Failed to queue match score caching', { error: err, jobId: job.id })
    // Don't throw - caching is nice-to-have, not critical
  })

  revalidatePath('/employer')
  revalidatePath('/jobs')

  return job
}

const VALID_JOB_STATUSES = ['DRAFT', 'PUBLISHED', 'PAUSED', 'CLOSED'] as const

/**
 * Roles allowed to modify a job posting — the same set `PATCH`/`DELETE
 * /api/jobs/[id]` enforces. Server actions reach the identical mutation without
 * passing through `withCsrfProtection`/`withRateLimit`, so they must not be the
 * softer of the two doors: before this, any member (including AGENCY) could
 * close or delete another team's posting through the action while the API
 * refused them.
 */
const JOB_WRITE_ROLES = ['ORG_ADMIN', 'RECRUITER']

/**
 * Loads a job and asserts the caller may write to it.
 *
 * Uses `findFirst`, not `findUnique`: the soft-delete middleware in lib/prisma.ts
 * only injects `deletedAt: null` for findFirst/findMany/count, so `findUnique`
 * happily returns soft-deleted rows — which let a deleted job be resurrected by
 * setting its status back to PUBLISHED.
 */
async function requireJobWriteAccess(jobId: string, userId: string): Promise<Job> {
  const job = await prisma.job.findFirst({
    where: { id: jobId },
  })

  if (!job) {
    throw new Error('Job not found')
  }

  const membership = await prisma.userOrgRole.findFirst({
    where: {
      userId,
      orgId: job.orgId,
      deletedAt: null,
    },
  })

  if (!membership || !JOB_WRITE_ROLES.includes(membership.role)) {
    throw new Error('Forbidden')
  }

  return job
}

export async function updateJobStatus(jobId: string, status: string): Promise<Job> {
  if (!VALID_JOB_STATUSES.includes(status as (typeof VALID_JOB_STATUSES)[number])) {
    throw new Error('Invalid status value')
  }

  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  await requireJobWriteAccess(jobId, session.user.id)

  const updatedJob = await prisma.job.update({
    where: { id: jobId },
    data: { status },
  })

  revalidatePath('/employer')
  revalidatePath('/jobs')

  return updatedJob
}

export async function deleteJob(jobId: string): Promise<{ success: true }> {
  const session = await auth()

  if (!session?.user?.id) {
    throw new Error('Unauthorized')
  }

  await requireJobWriteAccess(jobId, session.user.id)

  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'CLOSED', deletedAt: new Date() },
  })

  revalidatePath('/employer')
  revalidatePath('/jobs')

  return { success: true }
}
