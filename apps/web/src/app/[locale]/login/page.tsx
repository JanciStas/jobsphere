import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { ShieldAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import LoginClient from './login-client'

type Props = {
  params: { locale: string }
  searchParams?: Record<string, string | string[] | undefined>
}

export async function generateMetadata({ params: { locale } }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return { title: t('login.title'), description: t('login.description') }
}

export default async function LoginPage({ params, searchParams }: Props) {
  // `middleware.ts` and the admin layouts bounce unauthorised users here with
  // `?error=forbidden`. Until now nothing read that param, so the user landed
  // on a plain login form with no idea why they were thrown out.
  const rawError = searchParams?.error
  const error = Array.isArray(rawError) ? rawError[0] : rawError

  let notice: React.ReactNode = null
  if (error === 'forbidden') {
    const tEmployer = await getTranslations({ locale: params.locale, namespace: 'employer' })
    const tLogin = await getTranslations({ locale: params.locale, namespace: 'auth.login' })
    notice = (
      <Alert variant="destructive">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>{tEmployer('accessDenied')}</AlertTitle>
        <AlertDescription>{tLogin('subtitle')}</AlertDescription>
      </Alert>
    )
  }

  // Mirrors the provider registration in lib/auth.ts — a button for a
  // provider that isn't configured just throws when clicked.
  const providersAvailable = {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    apple: Boolean(process.env.APPLE_ID && process.env.APPLE_SECRET),
  }

  return <LoginClient params={params} notice={notice} providersAvailable={providersAvailable} />
}
