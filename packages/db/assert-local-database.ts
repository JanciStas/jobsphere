/**
 * Safety guard for destructive seed scripts (they delete/TRUNCATE core tables).
 * Refuses to run unless DATABASE_URL points at a local database.
 *
 * Shared by packages/db/seed.ts and apps/web/prisma/seed.ts.
 */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']

export function assertLocalDatabase(url: string | undefined = process.env.DATABASE_URL): void {
  let parsed: URL | null = null
  try {
    parsed = new URL(url ?? '')
  } catch {
    parsed = null
  }

  const host = parsed?.hostname ?? ''

  // Prisma (and libpq) honour ?host= / ?hostaddr= / ?service= as the real connection
  // target, so "postgresql://u:p@localhost/db?host=prod.example.com" would pass a naive
  // hostname check while connecting to production. Reject them outright.
  const overridesHost =
    parsed !== null && ['host', 'hostaddr', 'service'].some((p) => parsed.searchParams.has(p))

  if (!parsed || overridesHost || !LOCAL_HOSTS.includes(host)) {
    throw new Error(
      `Refusing to seed: DATABASE_URL host "${host || 'unset'}"${overridesHost ? ' (with host override)' : ''} ` +
        'is not a plain local database. This seed deletes data and must never run against production.',
    )
  }
}
