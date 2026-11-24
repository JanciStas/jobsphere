import { AlertTriangle } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

/** Shown in the CMS admin while the CMS tables are not in the database yet. */
export function NotMigratedNotice({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
