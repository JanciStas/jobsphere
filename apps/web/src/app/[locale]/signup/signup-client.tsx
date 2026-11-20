'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Eye, EyeOff } from 'lucide-react'
import { portalHome, type Portal } from '@/lib/portal'

type SignupRole = Portal

const signupSchema = z
  .object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(12),
    confirmPassword: z.string(),
    role: z.enum(['candidate', 'employer', 'agency', 'freelancer']),
    companyName: z.string().optional(),
    acceptTerms: z.literal(true),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
  })
  .refine(
    (data) =>
      (data.role !== 'employer' && data.role !== 'agency') ||
      (data.companyName && data.companyName.length > 0),
    {
      path: ['companyName'],
    },
  )

export default function SignupClient({
  params,
  initialRole = 'candidate',
}: {
  params: { locale: string }
  /** Pre-selected from `?role=` (validated server-side in page.tsx). */
  initialRole?: SignupRole
}) {
  const t = useTranslations('auth.signup')
  const tp = useTranslations('authPortals')
  const router = useRouter()
  const locale = params.locale
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [role, setRole] = useState<SignupRole>(initialRole)
  const needsCompany = role === 'employer' || role === 'agency'
  const [companyName, setCompanyName] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const result = signupSchema.safeParse({
      name,
      email,
      password,
      confirmPassword,
      role,
      companyName: needsCompany ? companyName : undefined,
      acceptTerms,
    })

    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors
      const formErrors = result.error.flatten().formErrors

      if (fieldErrors.acceptTerms) {
        setError(t('errors.acceptTerms'))
        return
      }
      if (fieldErrors.password) {
        setError(t('errors.passwordLength'))
        return
      }
      if (fieldErrors.confirmPassword || formErrors.length > 0) {
        setError(t('errors.passwordMismatch'))
        return
      }
      if (fieldErrors.companyName) {
        setError(
          role === 'agency' ? tp('signup.companyRequiredAgency') : t('errors.companyRequired'),
        )
        return
      }
      setError(t('errors.generic'))
      return
    }

    setLoading(true)

    try {
      // Create user account
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          role,
          companyName: needsCompany ? companyName : undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || t('errors.createFailed'))
      }

      // Auto sign in after successful registration
      const signInResult = await signIn('credentials', {
        email,
        password,
        portal: role,
        redirect: false,
      })

      if (signInResult?.error === 'EMAIL_NOT_VERIFIED') {
        setError(tp('signup.verifyEmail'))
      } else if (signInResult?.error) {
        setError(t('errors.signInFailed'))
      } else {
        // Redirect by role: candidate -> /dashboard, agency -> /agency/dashboard,
        // freelancer -> /freelancer/dashboard, employer -> /employer.
        router.push(portalHome(role, locale))
        router.refresh()
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        setError(error.message || t('errors.generic'))
      } else {
        setError(t('errors.generic'))
      }
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    await signIn('google', { callbackUrl: portalHome('candidate', locale) })
  }

  const handleAppleSignIn = async () => {
    setLoading(true)
    await signIn('apple', { callbackUrl: portalHome('candidate', locale) })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            {t('orContinueWith')} {t('google')}
          </Button>

          <Button
            variant="outline"
            className="w-full"
            onClick={handleAppleSignIn}
            disabled={loading}
          >
            <svg
              className="mr-2 h-4 w-4"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M16.365 1.43c0 1.14-.42 2.2-1.12 2.98-.76.84-1.96 1.49-3.05 1.4-.13-1.09.42-2.24 1.1-2.97.76-.83 2.05-1.45 3.07-1.41zM20.5 17.2c-.55 1.27-.82 1.84-1.53 2.96-.99 1.57-2.39 3.52-4.12 3.53-1.54.02-1.94-1-4.03-.99-2.09.01-2.53 1.01-4.07.99-1.73-.02-3.05-1.78-4.04-3.34C-.07 16.6-.36 11.42 1.6 8.7c1.16-1.62 2.99-2.57 4.71-2.57 1.75 0 2.85 1 4.3 1 1.4 0 2.26-1 4.29-1 1.53 0 3.16.84 4.32 2.28-3.79 2.08-3.18 7.49.28 8.79z" />
            </svg>
            {t('orContinueWith')} Apple
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">{t('divider')}</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-3">
              <Label>{t('registerAs')}</Label>
              <RadioGroup
                value={role}
                onValueChange={(value: string) => setRole(value as SignupRole)}
                disabled={loading}
              >
                <div className="flex items-center space-x-2 rounded-lg border p-3 hover:bg-muted/50">
                  <RadioGroupItem value="candidate" id="candidate" />
                  <Label htmlFor="candidate" className="flex-1 cursor-pointer font-normal">
                    <div className="font-semibold">{t('roleCandidate')}</div>
                    <p className="text-xs text-muted-foreground">{t('roleCandidateDesc')}</p>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-lg border p-3 hover:bg-muted/50">
                  <RadioGroupItem value="employer" id="employer" />
                  <Label htmlFor="employer" className="flex-1 cursor-pointer font-normal">
                    <div className="font-semibold">{t('roleEmployer')}</div>
                    <p className="text-xs text-muted-foreground">{t('roleEmployerDesc')}</p>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-lg border p-3 hover:bg-muted/50">
                  <RadioGroupItem value="agency" id="agency" />
                  <Label htmlFor="agency" className="flex-1 cursor-pointer font-normal">
                    <div className="font-semibold">{tp('signup.roleAgency')}</div>
                    <p className="text-xs text-muted-foreground">{tp('signup.roleAgencyDesc')}</p>
                  </Label>
                </div>
                <div className="flex items-center space-x-2 rounded-lg border p-3 hover:bg-muted/50">
                  <RadioGroupItem value="freelancer" id="freelancer" />
                  <Label htmlFor="freelancer" className="flex-1 cursor-pointer font-normal">
                    <div className="font-semibold">{tp('signup.roleFreelancer')}</div>
                    <p className="text-xs text-muted-foreground">
                      {tp('signup.roleFreelancerDesc')}
                    </p>
                  </Label>
                </div>
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="name">{t('name')}</Label>
              <Input
                id="name"
                type="text"
                name="name"
                autoComplete="name"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            {needsCompany && (
              <div className="space-y-2">
                <Label htmlFor="companyName">
                  {role === 'agency' ? tp('signup.agencyName') : t('companyName')}
                </Label>
                <Input
                  id="companyName"
                  type="text"
                  name="organization"
                  autoComplete="organization"
                  placeholder="Acme Inc."
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">{t('email')}</Label>
              <Input
                id="email"
                type="email"
                name="email"
                autoComplete="email"
                placeholder="name@example.com"
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
                  name="new-password"
                  autoComplete="new-password"
                  className="pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  minLength={12}
                />
                <button
                  type="button"
                  aria-label={showPassword ? tp('form.hidePassword') : tp('form.showPassword')}
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
              <p className="text-xs text-muted-foreground">{t('passwordHint')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('confirmPassword')}</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirm-password"
                  autoComplete="new-password"
                  className="pr-10"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  aria-label={
                    showConfirmPassword ? tp('form.hidePassword') : tp('form.showPassword')
                  }
                  aria-pressed={showConfirmPassword}
                  className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-start space-x-2">
              <Checkbox
                id="terms"
                checked={acceptTerms}
                onCheckedChange={(checked) => setAcceptTerms(checked as boolean)}
              />
              <label
                htmlFor="terms"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {t('terms')}
              </label>
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
              {loading ? t('creating') : t('submit')}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-center gap-2">
          <div className="text-sm text-muted-foreground">
            {t('hasAccount')}{' '}
            <Link href={`/${locale}/login/${role}`} className="text-primary hover:underline">
              {t('loginLink')}
            </Link>
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
