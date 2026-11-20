import Link from 'next/link'

interface AdminPagerProps {
  basePath: string
  query: Record<string, string | undefined>
  page: number
  totalPages: number
  prevLabel: string
  nextLabel: string
  pageLabel: string
}

/** Server-rendered prev/next pager that preserves the active filters. */
export function AdminPager({
  basePath,
  query,
  page,
  totalPages,
  prevLabel,
  nextLabel,
  pageLabel,
}: AdminPagerProps) {
  if (totalPages <= 1) return null
  const href = (p: number) => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(query)) if (v) sp.set(k, v)
    sp.set('page', String(p))
    return `${basePath}?${sp.toString()}`
  }
  const cls = 'rounded-md border px-3 py-1.5 text-sm hover:bg-slate-100'
  return (
    <nav className="flex items-center justify-center gap-3" aria-label="pagination">
      {page > 1 ? (
        <Link href={href(page - 1)} className={cls}>
          {prevLabel}
        </Link>
      ) : (
        <span className={`${cls} pointer-events-none opacity-40`}>{prevLabel}</span>
      )}
      <span className="text-sm text-slate-500">{pageLabel}</span>
      {page < totalPages ? (
        <Link href={href(page + 1)} className={cls}>
          {nextLabel}
        </Link>
      ) : (
        <span className={`${cls} pointer-events-none opacity-40`}>{nextLabel}</span>
      )}
    </nav>
  )
}
