/**
 * Audit Logging
 * Track security-relevant actions for compliance
 */

import { prisma } from './db'
import { Prisma } from '@prisma/client'
import { logger } from './logger'

export type AuditAction =
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_DELETED'
  | 'PASSWORD_CHANGED'
  | 'EMAIL_CHANGED'
  | 'JOB_CREATED'
  | 'JOB_UPDATED'
  | 'JOB_DELETED'
  | 'CANDIDATE_VIEWED'
  | 'CANDIDATE_EXPORTED'
  | 'APPLICATION_CREATED'
  | 'APPLICATION_UPDATED'
  | 'APPLICATION_DELETED'
  | 'APPLICATION_STATUS_CHANGED'
  | 'APPLICATION_BULK_UPDATE'
  | 'ASSESSMENT_CREATED'
  | 'ASSESSMENT_SUBMITTED'
  | 'EMAIL_SENT'
  | 'SUBSCRIPTION_CREATED'
  | 'SUBSCRIPTION_CANCELED'
  | 'DATA_EXPORTED'
  | 'CONSENT_GRANTED'
  | 'CONSENT_REVOKED'
  | 'DSAR_REQUESTED'
  // Generic actions for services
  | 'CREATE'
  | 'UPDATE'
  | 'DELETE'
  | 'BULK_UPDATE'
  // Platform-admin actions. These are the ones nobody could reconstruct before:
  // no admin route wrote an audit entry at all, so who banned whom, and who
  // handed out global admin, existed only in application logs.
  | 'BAN'
  | 'UNBAN'
  | 'PROMOTE_ADMIN'
  | 'DEMOTE_ADMIN'
  | 'SUSPEND'
  | 'ACTIVATE'
  | 'DSAR_PROCESSED'

export type AuditResource =
  | 'USER'
  | 'JOB'
  | 'CANDIDATE'
  | 'APPLICATION'
  | 'ASSESSMENT'
  | 'EMAIL'
  | 'SUBSCRIPTION'
  | 'CONSENT'
  | 'DSAR'
  // Admin-only surfaces
  | 'ORGANIZATION'
  | 'FREELANCER'
  | 'PORTFOLIO_ITEM'
  | 'GIG'
  | 'GIG_PROPOSAL'
  | 'SETTING'
  | 'FEATURE_FLAG'
  | 'SCRAPER'
  // CMS
  | 'CMS_PAGE'
  | 'CMS_FAQ'
  | 'CMS_TEXT'
  | 'BLOG_POST'
  | 'BLOG_CATEGORY'
  | 'ANNOUNCEMENT'
  | 'CAREER_PAGE'
  | 'CMS_UPLOAD'

export interface AuditLogEntry {
  userId?: string
  orgId?: string
  action: AuditAction
  resource: AuditResource
  resourceId?: string
  metadata?: Prisma.InputJsonValue
  /**
   * State before the change.
   *
   * The AuditLog row has always had an `oldValues` column and this helper never
   * wrote it. For an admin action that omission is most of the point: "was
   * promoted to admin" without what they were before answers half the question,
   * and "organisation suspended" without whether it was already suspended
   * answers none of it.
   */
  previous?: Prisma.InputJsonValue
  ipAddress?: string
  userAgent?: string
}

/**
 * Create audit log entry
 */
export async function createAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId,
        orgId: entry.orgId,
        action: entry.action,
        entityType: entry.resource,
        entityId: entry.resourceId || 'SYSTEM',
        // Store metadata in newValues field (changes field doesn't exist in schema)
        newValues: entry.metadata || {},
        oldValues: entry.previous,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      },
    })
  } catch (error) {
    // Log error but don't fail the main operation
    logger.error('Failed to create audit log', {
      error,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId,
    })
  }
}

/**
 * Helper to extract request metadata
 */
export function getRequestMetadata(request: Request): {
  ipAddress: string
  userAgent: string
} {
  return {
    ipAddress: request.headers.get('x-forwarded-for') || 'unknown',
    userAgent: request.headers.get('user-agent') || 'unknown',
  }
}

/**
 * Log user authentication
 */
export async function logUserLogin(userId: string, request: Request): Promise<void> {
  const { ipAddress, userAgent } = getRequestMetadata(request)

  await createAuditLog({
    userId,
    action: 'USER_LOGIN',
    resource: 'USER',
    resourceId: userId,
    ipAddress,
    userAgent,
  })
}

/**
 * Log data access (GDPR compliance)
 */
export async function logDataAccess(
  userId: string,
  orgId: string,
  resourceType: AuditResource,
  resourceId: string,
  request: Request,
): Promise<void> {
  const { ipAddress, userAgent } = getRequestMetadata(request)

  await createAuditLog({
    userId,
    orgId,
    action: 'CANDIDATE_VIEWED',
    resource: resourceType,
    resourceId,
    ipAddress,
    userAgent,
  })
}

/**
 * Log data export (GDPR compliance)
 */
export async function logDataExport(
  userId: string,
  orgId: string | undefined,
  exportType: string,
  request: Request,
): Promise<void> {
  const { ipAddress, userAgent } = getRequestMetadata(request)

  await createAuditLog({
    userId,
    orgId,
    action: 'DATA_EXPORTED',
    resource: 'CANDIDATE',
    resourceId: userId,
    metadata: { exportType },
    ipAddress,
    userAgent,
  })
}

/**
 * Log sensitive action
 */
export async function logSensitiveAction(
  userId: string,
  action: AuditAction,
  resource: AuditResource,
  resourceId: string,
  request: Request,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  const { ipAddress, userAgent } = getRequestMetadata(request)

  await createAuditLog({
    userId,
    action,
    resource,
    resourceId,
    metadata,
    ipAddress,
    userAgent,
  })
}

/**
 * Query audit logs with filters
 */
export async function queryAuditLogs(filters: {
  userId?: string
  orgId?: string
  action?: AuditAction
  resource?: AuditResource
  startDate?: Date
  endDate?: Date
  limit?: number
}) {
  const where: Prisma.AuditLogWhereInput = {}

  if (filters.userId) where.userId = filters.userId
  if (filters.orgId) where.orgId = filters.orgId
  if (filters.action) where.action = filters.action
  if (filters.resource) where.entityType = filters.resource

  if (filters.startDate || filters.endDate) {
    where.createdAt = {}
    if (filters.startDate) where.createdAt.gte = filters.startDate
    if (filters.endDate) where.createdAt.lte = filters.endDate
  }

  return prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filters.limit || 100,
  })
}
