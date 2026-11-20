/**
 * Shared list queries for the admin marketplace screens (freelancers, gigs).
 * Used by both the server-rendered pages and the /api/admin/* GET routes so the
 * two cannot drift apart.
 */

import { z } from 'zod'
import { prisma } from '@/lib/prisma'

/** http(s) only: z.string().url() alone accepts javascript: URLs, which end up in href. */
export const httpUrl = z
  .string()
  .trim()
  .max(300)
  .url()
  .refine((v) => /^https?:\/\//i.test(v), 'Only http(s) URLs are allowed')

export const AVAILABILITIES = ['AVAILABLE', 'LIMITED', 'UNAVAILABLE'] as const
export const GIG_STATUSES = ['OPEN', 'IN_PROGRESS', 'CLOSED'] as const
export const PROPOSAL_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const

export interface FreelancerListQuery {
  search?: string
  visible?: string // 'true' | 'false'
  availability?: string
  page: number
  limit: number
}

export function buildFreelancerWhere(
  q: Pick<FreelancerListQuery, 'search' | 'visible' | 'availability'>,
) {
  const search = q.search?.trim()
  return {
    ...(q.visible === 'true' ? { visible: true } : q.visible === 'false' ? { visible: false } : {}),
    ...((AVAILABILITIES as readonly string[]).includes(q.availability ?? '')
      ? { availability: q.availability }
      : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' as const } },
            { user: { name: { contains: search, mode: 'insensitive' as const } } },
            { user: { email: { contains: search, mode: 'insensitive' as const } } },
            { services: { has: search } },
            { skills: { has: search } },
          ],
        }
      : {}),
  }
}

export async function listFreelancers(q: FreelancerListQuery) {
  const where = buildFreelancerWhere(q)
  const [items, total] = await Promise.all([
    prisma.freelancerProfile.findMany({
      where,
      select: {
        id: true,
        title: true,
        services: true,
        hourlyRate: true,
        currency: true,
        availability: true,
        location: true,
        visible: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { proposals: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.freelancerProfile.count({ where }),
  ])
  return { items, total, page: q.page, limit: q.limit }
}

export interface GigListQuery {
  search?: string
  status?: string
  orgId?: string
  agency?: string // '1' => only organisations with an AGENCY member
  page: number
  limit: number
}

export function buildGigWhere(q: Pick<GigListQuery, 'search' | 'status' | 'orgId' | 'agency'>) {
  const search = q.search?.trim()
  return {
    ...((GIG_STATUSES as readonly string[]).includes(q.status ?? '') ? { status: q.status } : {}),
    ...(q.orgId ? { orgId: q.orgId } : {}),
    ...(q.agency === '1'
      ? { organization: { users: { some: { role: 'AGENCY', deletedAt: null } } } }
      : {}),
    ...(search
      ? {
          OR: [
            { title: { contains: search, mode: 'insensitive' as const } },
            { organization: { name: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  }
}

export async function listGigs(q: GigListQuery) {
  const where = buildGigWhere(q)
  const [items, total] = await Promise.all([
    prisma.gig.findMany({
      where,
      select: {
        id: true,
        title: true,
        budget: true,
        currency: true,
        durationDays: true,
        status: true,
        createdAt: true,
        orgId: true,
        organization: { select: { id: true, name: true } },
        _count: { select: { proposals: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.gig.count({ where }),
  ])
  return { items, total, page: q.page, limit: q.limit }
}
