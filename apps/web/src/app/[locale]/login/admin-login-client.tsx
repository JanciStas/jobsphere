'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { ShieldCheck, Eye, EyeOff } from 'lucide-react'
import { portalHome } from '@/lib/portal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

/**
 * Sign-in for platform administrators (/login/admin).
 *
 * Deliberately minimal: no registration link, no OAuth, no role picker. The server enforces
 * the portal in `authorize` (lib/auth.ts) — a non-admin gets the same generic error as a wrong
 * password, so this page does not reveal which accounts are administrators.
 */
export default function AdminLoginClient({
  locale,
  notice,
  callbackUrl = null,
}: {
  locale: string
  notice?: React.ReactNode
  /** Pre-validated (lib/safe-callback.ts) in-app path to return to after login. */
  callbackUrl?: string | null
}) {
  const t = useTranslations('adminCore.login')
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!loginSchema.safeParse({ email, password }).success) {
      setError(t('invalidCredentials'))
      return
    }

    setLoading(true)
    try {
      const result = await signIn('credentials', {
        email,
        password,
        portal: 'admin',
        redirect: false,
      })

      if (result?.error === 'EMAIL_NOT_VERIFIED') {
        setError(t('emailNotVerified'))
      } else if (result?.error) {
        // WRONG_PORTAL (not an admin) is intentionally shown as a plain bad-credentials error.
        setError(t('invalidCredentials'))
      } else {
        router.push(callbackUrl ?? portalHome('admin', locale))
        router.refresh()
      }
    } catch {
      setError(t('error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-1">
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl font-bold">{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {notice}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input
                id="email"
                type="email"
                name="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('password')}</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  className="pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                  aria-pressed={showPassword}
                  className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>
            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('signingIn') : t('submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
