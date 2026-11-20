import { Badge } from '@/components/ui/badge'

/** Visual variant per gig / proposal status. Label text comes from the caller (i18n). */
export function StatusBadge({ status, label }: { status: string; label: string }) {
  switch (status) {
    case 'OPEN':
    case 'PENDING':
      return <Badge variant="secondary">{label}</Badge>
    case 'IN_PROGRESS':
    case 'ACCEPTED':
      return <Badge className="bg-green-600 hover:bg-green-600">{label}</Badge>
    case 'REJECTED':
      return <Badge variant="destructive">{label}</Badge>
    default:
      return <Badge variant="outline">{label}</Badge>
  }
}
