/**
 * Admin actions must leave a record.
 *
 * `createAuditLog` was called from the services layer and from nowhere under
 * `api/admin/**`. Admin routes write to Prisma directly, so who banned a user,
 * who granted global admin, who suspended an organisation and who flipped a
 * feature flag existed only in application logs — not in the AuditLog table the
 * product presents as its audit trail.
 *
 * The irony worth recording: `admin/users/[id]` renders a card titled "audit
 * log", but it shows actions performed BY that user, never actions performed on
 * them. An admin looking for evidence of a ban would find the page reassuringly
 * populated and entirely silent on the thing they came for.
 *
 * This gate is the same shape as route-wrapper-contract.test.ts: state the rule
 * once, enforce it over the whole directory, including handlers nobody has
 * written yet.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { analyzeAllRoutes, MUTATING_METHODS } from './route-contract-analyzer'

const WEB_ROOT = join(__dirname, '..', '..')
const APP_DIR = join(WEB_ROOT, 'src', 'app')
const API_DIR = join(APP_DIR, 'api')

/**
 * Routes that mutate without needing an audit entry, with a reason.
 * A stale entry fails the suite, same as the wrapper allowlist.
 */
const ALLOWLIST: { route: string; method: string; reason: string }[] = [
  {
    route: '/api/admin/scraper/run',
    method: 'POST',
    reason:
      'Enqueues a scrape pass; it changes no records itself, and the import path ' +
      'writes its own consent-gated trail. Revisit if it ever writes directly.',
  },
]

const adminHandlers = analyzeAllRoutes(API_DIR, APP_DIR, WEB_ROOT)
  .filter((h) => h.route.startsWith('/api/admin/'))
  .filter((h) => MUTATING_METHODS.includes(h.method))

/** True when the file contains a call to createAuditLog or a logging helper built on it. */
function writesAuditLog(file: string): boolean {
  const source = readFileSync(join(WEB_ROOT, file), 'utf8')
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)

  // runBillingAction (lib/admin-billing.ts) writes the audit entry itself — it knows before/after.
  const AUDIT_CALLS = new Set([
    'createAuditLog',
    'logSensitiveAction',
    'logDataExport',
    'runBillingAction',
  ])
  let found = false

  const visit = (node: ts.Node) => {
    if (found) return
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (AUDIT_CALLS.has(node.expression.text)) {
        found = true
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

const allowed = new Set(ALLOWLIST.map((e) => `${e.method} ${e.route}`))

describe('admin audit contract', () => {
  it('finds the admin mutation surface', () => {
    // Without this, a moved directory would turn the rule below into a vacuous
    // pass over an empty array — the failure mode that let ESLint's
    // ignorePatterns lint zero files unnoticed for months.
    expect(adminHandlers.length).toBeGreaterThanOrEqual(8)
  })

  it('every mutating admin handler records an audit entry', () => {
    const silent = adminHandlers
      .filter((h) => !allowed.has(`${h.method} ${h.route}`))
      .filter((h) => !writesAuditLog(h.file))
      .map((h) => `${h.method} ${h.route}  (${h.file})`)

    expect(silent).toEqual([])
  })

  it('has no allowlist entry for a route that no longer mutates', () => {
    const live = new Set(adminHandlers.map((h) => `${h.method} ${h.route}`))
    const orphans = ALLOWLIST.filter((e) => !live.has(`${e.method} ${e.route}`)).map(
      (e) => `${e.method} ${e.route}`,
    )
    expect(orphans).toEqual([])
  })

  it('has no allowlist entry for a route that now audits anyway', () => {
    const unnecessary = ALLOWLIST.filter((e) => {
      const handler = adminHandlers.find((h) => h.method === e.method && h.route === e.route)
      return handler && writesAuditLog(handler.file)
    }).map((e) => `${e.method} ${e.route}`)
    expect(unnecessary).toEqual([])
  })

  it('gives every exemption a substantive reason', () => {
    const weak = ALLOWLIST.filter((e) => e.reason.trim().length < 30).map(
      (e) => `${e.method} ${e.route}`,
    )
    expect(weak).toEqual([])
  })
})
