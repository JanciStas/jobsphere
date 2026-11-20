import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { isPortal } from '@/lib/portal'
import { safeCallbackPath } from '@/lib/safe-callback'
import { ForbiddenNotice } from '../forbidden-notice'
import LoginClient from '../login-client'
import AdminLoginClient from '../admin-login-client'

type Props = {
  params: { locale: string; role: string }
  searchParams?: Record<string, string | string[] | undefined>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, role } = await params
  if (!isPortal(role)) return {}
  if (role === 'admin') {
    const ta = await getTranslations({ locale, namespace: 'adminCore.login' })
    // Not indexable: the admin entry point must not show up in search results.
    return { title: ta('title'), robots: { index: false, follow: false } }
  }
  const t = await getTranslations({ locale, namespace: 'authPortals' })
  return { title: t(`roles.${role}.loginTitle`), description: t(`roles.${role}.loginSubtitle`) }
}

export default async function LoginRolePage({ params, searchParams }: Props) {
  const { locale, role } = await params
  if (!isPortal(role)) notFound()

  const rawError = searchParams?.error
  const error = Array.isArray(rawError) ? rawError[0] : rawError
  const rawCallback = searchParams?.callbackUrl
  const callbackUrl = safeCallbackPath(
    Array.isArray(rawCallback) ? rawCallback[0] : rawCallback,
    locale,
  )

  if (role === 'admin') {
    const ta = await getTranslations({ locale, namespace: 'adminCore.login' })
    const adminNotice =
      error === 'forbidden' ? (
        <div role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {ta('forbidden')}
        </div>
      ) : null
    return <AdminLoginClient locale={locale} notice={adminNotice} callbackUrl={callbackUrl} />
  }

  const notice = error === 'forbidden' ? <ForbiddenNotice locale={locale} /> : null

  // Mirrors the provider registration in lib/auth.ts — a button for a
  // provider that isn't configured just throws when clicked.
  const providersAvailable = {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    apple: Boolean(process.env.APPLE_ID && process.env.APPLE_SECRET),
  }

  return (
    <LoginClient
      params={{ locale }}
      portal={role}
      notice={notice}
      providersAvailable={providersAvailable}
      callbackUrl={callbackUrl}
    />
  )
}
