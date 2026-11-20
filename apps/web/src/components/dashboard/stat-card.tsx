import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  value: number | string
  label: string
  icon: LucideIcon
}

/** Jobtex-style KPI tile: big number + label + tinted icon. */
export function StatCard({ value, label, icon: Icon }: StatCardProps) {
  return (
    <div className="flex items-center gap-4 rounded-lg border bg-card p-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}
