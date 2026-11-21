/** Highest page number any admin list accepts; anything above is clamped. */
export const MAX_PAGE = 100_000

/**
 * `?page=` → a finite integer in [1, MAX_PAGE]. NaN, Infinity, negatives and junk fall back to
 * 1 so Prisma never receives a NaN/Infinity/overflowing `skip` (which would 500 the request).
 */
export function parsePageNumber(raw: string | null | undefined): number {
  const n = Math.floor(Number(raw ?? '1'))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, MAX_PAGE)
}

/** `?limit=` → a finite integer in [1, max]; junk falls back to `fallback`. */
export function parseLimit(raw: string | null | undefined, fallback: number, max = 100): number {
  const n = Math.floor(Number(raw ?? String(fallback)))
  if (!Number.isFinite(n) || n < 1) return Math.min(fallback, max)
  return Math.min(n, max)
}
