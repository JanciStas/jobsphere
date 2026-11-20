import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Briefcase, Building2, UserRound } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { safeCallbackPath } from '@/lib/safe-callback'
import { ForbiddenNotice } from './forbidden-notice'

type Props = {
  params: { locale: string }
  searchParams?: Record<string, string | string[] | undefined>
}

export async function generateMetadata({ params: { locale } }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return { title: t('login.title'), description: t('login.description') }
}

const CARDS = [
  { role: 'candidate', icon: UserRound },
  { role: 'agency', icon: Building2 },
  { role: 'freelancer', icon: Briefcase },
] as const

export default async function LoginChooserPage({ params, searchParams }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'authPortals' })

  const rawError = searchParams?.error
  const error = Array.isArray(rawError) ? rawError[0] : rawError

  const rawCallback = searchParams?.callbackUrl
  const callbackUrl = safeCallbackPath(
    Array.isArray(rawCallback) ? rawCallback[0] : rawCallback,
    locale,
  )
  const qs = callbackUrl ? `?callbackUrl=${encodeURIComponent(callbackUrl)}` : ''

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md space-y-4">
        <Card className="shadow-lg">
          <CardHeader className="space-y-1 text-center">
            <CardTitle className="text-2xl font-bold">{t('chooser.title')}</CardTitle>
            <CardDescription>{t('chooser.subtitle')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {error === 'forbidden' && <ForbiddenNotice locale={locale} />}
            {CARDS.map(({ role, icon: Icon }) => (
              <Link
                key={role}
                href={`/${locale}/login/${role}${qs}`}
                className="group flex items-center gap-4 rounded-lg border bg-background p-4 transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="flex-1">
                  <span className="block font-semibold">{t(`roles.${role}.name`)}</span>
                  <span className="block text-sm text-muted-foreground">
                    {t(`roles.${role}.cardDesc`)}
                  </span>
                </span>
                <ArrowRight
                  className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </Link>
            ))}
          </CardContent>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          {t('chooser.employerPrompt')}{' '}
          <Link href={`/${locale}/login/employer${qs}`} className="text-primary hover:underline">
            {t('chooser.employerLink')}
          </Link>
        </p>
        <p className="text-center text-sm text-muted-foreground">
          {t('form.noAccount')}{' '}
          <Link href={`/${locale}/signup`} className="text-primary hover:underline">
            {t('form.signupLink')}
          </Link>
        </p>
      </div>
    </div>
  )
}
