/**
 * Static analyzer for App Router route handlers.
 *
 * Answers one question per exported HTTP method: which protective wrappers is it
 * built from, and does its body reach an auth guard? The contract test in
 * `route-wrapper-contract.test.ts` turns those answers into a pass/fail gate.
 *
 * Why an AST and not a regex: a handler can be declared as
 * `export async function POST()`, as `export const POST = withCsrfProtection(withRateLimit(fn, opts))`,
 * as `export const POST = handler` pointing at a local const, or re-exported via
 * `export { h as POST }`. A regex that covers all four either misses real routes
 * or matches the word "withRateLimit" inside a comment. `typescript` is already a
 * devDependency, so parsing costs nothing extra.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import ts from 'typescript'

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type HttpMethod = (typeof HTTP_METHODS)[number]

/** Methods that change state, and therefore need CSRF + rate limiting. */
export const MUTATING_METHODS: readonly HttpMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Identifiers that establish who the caller is. `auth` covers `await auth()` from
 * NextAuth; the `require*` helpers throw when the caller is anonymous or lacks the
 * role. A route that calls none of these is either public or broken.
 */
const AUTH_GUARD_IDENTIFIERS = new Set([
  // NextAuth session accessors
  'auth',
  'getServerSession',
  // src/lib/auth.ts
  'requireAuth',
  'requireGlobalAdmin',
  // src/lib/admin-guard.ts — 401 for anonymous, 403 for non-admin
  'requireAdminApi',
  // src/lib/admin-billing.ts — guardAdmin() (401/403) runs inside runBillingAction
  'runBillingAction',
  // src/lib/api-helpers.ts
  'requireOrgAuth',
  'requireRole',
  'optionalAuth',
  // src/lib/jobs/cron-auth.ts — the caller is Vercel Cron, identified by a
  // shared secret rather than a session. It guards a data-erasure endpoint, so
  // it belongs here rather than in the allowlist of unauthenticated routes.
  'requireCronAuth',
])

export interface RouteHandler {
  /** Repo-relative POSIX path, e.g. `src/app/api/jobs/route.ts`. */
  file: string
  /** URL path the file serves, e.g. `/api/jobs/[id]`. */
  route: string
  method: HttpMethod
  /** Wrapper identifiers applied to this handler, outermost first. */
  wrappers: string[]
  hasCsrf: boolean
  hasRateLimit: boolean
  /** True when an auth-guard identifier is called anywhere in the handler body. */
  hasAuthGuard: boolean
}

/** Every `route.ts` under the given api directory, sorted for stable output. */
export function findRouteFiles(apiDir: string): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'route.ts' || entry.name === 'route.tsx') found.push(full)
    }
  }
  walk(apiDir)
  return found.sort()
}

/** `…/src/app/api/jobs/[id]/route.ts` -> `/api/jobs/[id]` */
function routePathFromFile(file: string, appDir: string): string {
  const rel = relative(appDir, file).split(sep).join('/')
  const withoutFile = rel.replace(/\/route\.tsx?$/, '')
  // Route groups like `(marketing)` are organisational only — they never appear in the URL.
  const segments = withoutFile.split('/').filter((s) => !(s.startsWith('(') && s.endsWith(')')))
  return '/' + segments.join('/')
}

/**
 * Unwraps a handler expression into the chain of wrapper identifiers plus the
 * innermost function, if we can see it.
 *
 * `withCsrfProtection(withRateLimit(fn, opts))` yields
 * `['withCsrfProtection', 'withRateLimit']` and `fn`.
 */
function unwrap(expr: ts.Expression): { wrappers: string[]; inner: ts.Node } {
  const wrappers: string[] = []
  let current: ts.Node = expr

  while (ts.isCallExpression(current)) {
    const callee = current.expression
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : null
    if (!name) break
    wrappers.push(name)
    // The handler is conventionally the first argument of these HOFs.
    if (current.arguments.length === 0) break
    current = current.arguments[0]
  }

  return { wrappers, inner: current }
}

/** True when any identifier in `node`'s subtree is a known auth guard being called. */
function containsAuthGuard(node: ts.Node): boolean {
  let found = false
  const visit = (n: ts.Node) => {
    if (found) return
    if (ts.isCallExpression(n)) {
      const callee = n.expression
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null
      if (name && AUTH_GUARD_IDENTIFIERS.has(name)) {
        found = true
        return
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

export function analyzeRouteFile(file: string, appDir: string, repoRoot: string): RouteHandler[] {
  const source = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)

  // Local declarations, so `export const POST = handler` can be followed to `handler`.
  const locals = new Map<string, ts.Node>()
  for (const stmt of sf.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer)
          locals.set(decl.name.text, decl.initializer)
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      locals.set(stmt.name.text, stmt)
    }
  }

  const isExported = (stmt: ts.Statement) =>
    ts.canHaveModifiers(stmt) &&
    ts.getModifiers(stmt)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)

  const handlers: RouteHandler[] = []
  const route = routePathFromFile(file, appDir)
  const relFile = relative(repoRoot, file).split(sep).join('/')

  const record = (method: HttpMethod, expr: ts.Node) => {
    let wrappers: string[] = []
    let inner: ts.Node = expr

    if (ts.isExpression(expr as ts.Expression) && ts.isCallExpression(expr)) {
      const un = unwrap(expr)
      wrappers = un.wrappers
      inner = un.inner
    }

    // `export const POST = someLocalHandler` — follow one hop to the real body.
    if (ts.isIdentifier(inner) && locals.has(inner.text)) {
      const target = locals.get(inner.text)!
      if (ts.isCallExpression(target)) {
        const un = unwrap(target)
        wrappers = [...wrappers, ...un.wrappers]
        inner = un.inner
      } else {
        inner = target
      }
    }

    handlers.push({
      file: relFile,
      route,
      method,
      wrappers,
      hasCsrf: wrappers.includes('withCsrfProtection'),
      hasRateLimit: wrappers.includes('withRateLimit'),
      // Search the whole file: a handler often delegates to a local helper that
      // performs the auth check, and following every call graph edge would be
      // more machinery than this gate needs.
      hasAuthGuard: containsAuthGuard(inner) || containsAuthGuard(sf),
    })
  }

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && isExported(stmt)) {
      const name = stmt.name.text as HttpMethod
      if (HTTP_METHODS.includes(name)) record(name, stmt)
    } else if (ts.isVariableStatement(stmt) && isExported(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue
        const name = decl.name.text as HttpMethod
        if (HTTP_METHODS.includes(name)) record(name, decl.initializer)
      }
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.exportClause &&
      ts.isNamedExports(stmt.exportClause)
    ) {
      // `export { handler as GET, handler as POST }`
      for (const spec of stmt.exportClause.elements) {
        const name = spec.name.text as HttpMethod
        if (!HTTP_METHODS.includes(name)) continue
        const localName = (spec.propertyName ?? spec.name).text
        record(name, locals.get(localName) ?? spec)
      }
    }
  }

  return handlers
}

export function analyzeAllRoutes(apiDir: string, appDir: string, repoRoot: string): RouteHandler[] {
  return findRouteFiles(apiDir).flatMap((f) => analyzeRouteFile(f, appDir, repoRoot))
}
