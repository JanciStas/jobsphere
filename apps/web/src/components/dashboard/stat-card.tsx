import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  value: number | string
  label: string
  icon: LucideIcon
}

/** Jobtex-style KPI tile: big number + label + tinted icon. */
export function StatCard({ value, label, icon: Icon }: StatCardProps) {
  return (
    <div className="flex items-center gap-5 rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-8 w-8" aria-hidden="true" />
      </div>
      <div>
        <p className="text-4xl font-bold leading-none">{value}</p>
        <p className="mt-2 text-base text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}
