import type { LucideIcon } from 'lucide-react'

interface AdminKpiCardProps {
  /** Pre-formatted value; `null` renders an em dash (the block failed to load). */
  value: string | null
  label: string
  icon: LucideIcon
  /** Small secondary line, e.g. "+12 in the last 7 days". */
  hint?: string | null
}

/** Jobtex-style KPI tile used on the admin overview. */
export function AdminKpiCard({ value, label, icon: Icon, hint }: AdminKpiCardProps) {
  return (
    <div className="flex items-center gap-5 rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-8 w-8" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-4xl font-bold leading-none">{value ?? '—'}</p>
        <p className="mt-2 text-base text-muted-foreground">{label}</p>
        {hint ? <p className="mt-1 text-sm text-primary">{hint}</p> : null}
      </div>
    </div>
  )
}
