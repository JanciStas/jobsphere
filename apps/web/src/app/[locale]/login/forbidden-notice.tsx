import { getTranslations } from 'next-intl/server'
import { ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/**
 * `middleware.ts` and the admin layouts bounce unauthorised users to the login pages
 * with `?error=forbidden`; this explains why they were thrown out.
 */
export async function ForbiddenNotice({ locale }: { locale: string }) {
  const tEmployer = await getTranslations({ locale, namespace: 'employer' })
  const tLogin = await getTranslations({ locale, namespace: 'auth.login' })
  return (
    <Alert variant="destructive">
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>{tEmployer('accessDenied')}</AlertTitle>
      <AlertDescription>{tLogin('subtitle')}</AlertDescription>
    </Alert>
  )
}
