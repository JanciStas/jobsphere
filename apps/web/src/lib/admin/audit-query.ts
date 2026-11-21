/**
 * Audit-log browsing for the admin panel: filter parsing, paging, JSON diff, CSV export.
 * Server-side only (uses Prisma); the pure helpers (diff, csv, schema) are unit tested.
 */

import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

export const AUDIT_PAGE_SIZE = 50
export const AUDIT_EXPORT_LIMIT = 5000

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v)
const upperToken = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .trim()
    .max(64)
    .regex(/^[A-Z0-9_]+$/)
    .optional(),
)
const isoDay = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
)

export const auditFilterSchema = z.object({
  action: upperToken,
  entityType: upperToken,
  /** Actor: a user id or (part of) an e-mail address. */
  user: z.preprocess(emptyToUndefined, z.string().trim().max(200).optional()),
  from: isoDay,
  to: isoDay,
  page: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(100000).default(1)),
})

export type AuditFilters = z.infer<typeof auditFilterSchema>

/** Never throws: an invalid value is dropped instead of breaking the page. */
export function parseAuditFilters(
  raw: Record<string, string | string[] | undefined>,
): AuditFilters {
  const flat: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(raw)) flat[k] = Array.isArray(v) ? v[0] : v
  const strict = auditFilterSchema.safeParse(flat)
  if (strict.success) return strict.data
  const bad = new Set(strict.error.issues.map((i) => String(i.path[0])))
  const cleaned = Object.fromEntries(Object.entries(flat).filter(([k]) => !bad.has(k)))
  const second = auditFilterSchema.safeParse(cleaned)
  return second.success ? second.data : { page: 1 }
}

/** Admins work in Slovak time; audit day filters and timestamps follow it (DST aware). */
export const AUDIT_TIME_ZONE = 'Europe/Bratislava'

const zoneParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: AUDIT_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function wallClock(d: Date): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of zoneParts.formatToParts(d))
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  return out
}

/** Offset of the audit zone from UTC at instant `t`, in ms (e.g. +1h in winter). */
function zoneOffsetMs(t: number): number {
  const w = wallClock(new Date(t))
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - (t - (t % 1000))
}

/** The UTC instant of 00:00 Slovak time on `day` (YYYY-MM-DD); undefined for impossible dates. */
function zonedDayStart(day: string): Date | undefined {
  const [y, m, d] = day.split('-').map(Number)
  const naive = Date.UTC(y, m - 1, d)
  const check = new Date(naive)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return undefined
  }
  // Two passes: the offset at the guessed instant may differ from the one at local midnight.
  let t = naive - zoneOffsetMs(naive)
  t = naive - zoneOffsetMs(t)
  return new Date(t)
}

/** Start of the Slovak day after `day` (exclusive upper bound). */
function zonedNextDayStart(day: string): Date | undefined {
  if (!zonedDayStart(day)) return undefined
  const next = new Date(`${day}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return zonedDayStart(next.toISOString().slice(0, 10))
}

/** "YYYY-MM-DD HH:mm" in Slovak time, for the audit table. */
export function formatAuditTime(d: Date): string {
  const w = wallClock(d)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${w.year}-${p(w.month)}-${p(w.day)} ${p(w.hour)}:${p(w.minute)}`
}

/** Resolve the "user" filter into a list of user ids (empty array = nobody matches). */
async function resolveActorIds(user: string): Promise<string[]> {
  if (!user.includes('@')) return [user]
  const found = await prisma.user.findMany({
    where: { email: { contains: user, mode: 'insensitive' } },
    select: { id: true },
    take: 50,
  })
  return found.map((u) => u.id)
}

export async function buildAuditWhere(f: AuditFilters): Promise<Prisma.AuditLogWhereInput> {
  const where: Prisma.AuditLogWhereInput = {}
  if (f.action) where.action = f.action
  if (f.entityType) where.entityType = f.entityType
  if (f.user) where.userId = { in: await resolveActorIds(f.user) }
  const gte = f.from ? zonedDayStart(f.from) : undefined
  const lt = f.to ? zonedNextDayStart(f.to) : undefined
  if (gte || lt) where.createdAt = { ...(gte && { gte }), ...(lt && { lt }) }
  return where
}

export async function queryAuditPage(f: AuditFilters) {
  const where = await buildAuditWhere(f)
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (f.page - 1) * AUDIT_PAGE_SIZE,
      take: AUDIT_PAGE_SIZE,
    }),
  ])
  return { total, rows, pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)) }
}

// ---------------------------------------------------------------------------
// JSON diff
// ---------------------------------------------------------------------------

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|api[-_]?key/i

export interface DiffEntry {
  key: string
  kind: 'added' | 'removed' | 'changed'
  before?: unknown
  after?: unknown
}

function redact(key: string, value: unknown): unknown {
  return SENSITIVE_KEY.test(key) ? '[redacted]' : value
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

/** Top-level key diff between the stored old and new values. Sensitive keys are redacted. */
export function diffJson(oldValues: unknown, newValues: unknown): DiffEntry[] {
  const a = asObject(oldValues)
  const b = asObject(newValues)
  if (!a && !b) {
    if (oldValues == null && newValues == null) return []
    return [{ key: '(value)', kind: 'changed', before: oldValues, after: newValues }]
  }
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].sort()
  const out: DiffEntry[] = []
  for (const key of keys) {
    const inA = !!a && key in a
    const inB = !!b && key in b
    const before = redact(key, a?.[key])
    const after = redact(key, b?.[key])
    if (inA && inB) {
      if (JSON.stringify(a![key]) !== JSON.stringify(b![key]))
        out.push({ key, kind: 'changed', before, after })
    } else if (inB) out.push({ key, kind: 'added', after })
    else out.push({ key, kind: 'removed', before })
  }
  return out
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Escapes a CSV cell and neutralises spreadsheet formula injection (=, +, -, @, tab, CR). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'string'
        ? value
        : JSON.stringify(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const AUDIT_CSV_HEADER = [
  'createdAt',
  'userId',
  'userEmail',
  'action',
  'entityType',
  'entityId',
  'ipAddress',
  'oldValues',
  'newValues',
] as const

export interface AuditCsvRow {
  createdAt: Date
  userId: string | null
  userEmail?: string | null
  action: string
  entityType: string | null
  entityId: string | null
  ipAddress: string | null
  oldValues: unknown
  newValues: unknown
}

function redactObject(v: unknown): unknown {
  const o = asObject(v)
  if (!o) return v
  return Object.fromEntries(Object.entries(o).map(([k, val]) => [k, redact(k, val)]))
}

/** userAgent is intentionally not part of the export. */
export function auditRowsToCsv(rows: AuditCsvRow[]): string {
  const lines: string[] = [AUDIT_CSV_HEADER.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.createdAt,
        r.userId,
        r.userEmail,
        r.action,
        r.entityType,
        r.entityId,
        r.ipAddress,
        r.oldValues == null ? null : redactObject(r.oldValues),
        r.newValues == null ? null : redactObject(r.newValues),
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return lines.join('\r\n') + '\r\n'
}

export async function queryAuditExport(f: AuditFilters) {
  const where = await buildAuditWhere(f)
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: AUDIT_EXPORT_LIMIT,
    select: {
      createdAt: true,
      userId: true,
      action: true,
      entityType: true,
      entityId: true,
      ipAddress: true,
      oldValues: true,
      newValues: true,
      user: { select: { email: true } },
    },
  })
  return rows.map((r) => ({ ...r, userEmail: r.user?.email ?? null }))
}
