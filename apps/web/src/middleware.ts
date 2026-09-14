import createMiddleware from 'next-intl/middleware'
import { NextRequest, NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { locales } from './i18n'

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale: 'sk',
  localeDetection: true,
})

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Protected routes that require authentication
  const protectedRoutes = ['/dashboard', '/employer', '/profile', '/admin', '/settings']
  const isProtectedRoute = protectedRoutes.some((route) => {
    const pathWithoutLocale = pathname.replace(/^\/(en|de|cs|sk|pl)/, '')
    return pathWithoutLocale.startsWith(route)
  })

  if (isProtectedRoute) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })
    // Only trust the first segment as a locale if it IS one. For a locale-less
    // URL like /dashboard the segment is "dashboard", and redirecting to
    // /dashboard/login lands back on a protected path — an infinite redirect
    // loop (ERR_TOO_MANY_REDIRECTS) for every old bookmark and emailed link.
    const firstSegment = pathname.split('/')[1]
    const locale = (locales as readonly string[]).includes(firstSegment) ? firstSegment : 'sk'
    if (!token) {
      return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
    }
    // /admin je vyhradený len pre globálnych adminov
    const pathWithoutLocale = pathname.replace(/^\/(en|de|cs|sk|pl)/, '')
    if (pathWithoutLocale.startsWith('/admin') && !token.isGlobalAdmin) {
      return NextResponse.redirect(new URL(`/${locale}/login?error=forbidden`, request.url))
    }
  }

  // Apply internationalization middleware
  const response = intlMiddleware(request)

  // Security headers
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    )
  }

  // Content Security Policy
  // NOTE (SEC-005): a nonce/'strict-dynamic' policy was attempted but reverted —
  // next-intl's middleware does not forward the per-request nonce header to the
  // App Router render, so Next's bootstrap scripts never receive the nonce and
  // 'strict-dynamic' would block ALL first-party scripts (blank app). Keeping
  // 'unsafe-inline' for scripts until a correctly-propagated, preview-verified
  // nonce implementation lands. 'unsafe-inline' for style-src is low risk.
  const isDev = process.env.NODE_ENV === 'development'
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://browser.sentry-cdn.com https://js.sentry-cdn.com https://accounts.google.com https://vercel.live"
    : "'self' 'unsafe-inline' https://js.stripe.com https://browser.sentry-cdn.com https://js.sentry-cdn.com https://accounts.google.com https://vercel.live"

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.public.blob.vercel-storage.com https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://*.stripe.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://api.stripe.com https://api.anthropic.com https://api.openai.com https://api.voyageai.com https://*.sentry.io https://*.ingest.sentry.io https://vitals.vercel-insights.com https://graph.microsoft.com https://login.microsoftonline.com",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://vercel.live",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
    'block-all-mixed-content',
  ].join('; ')

  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
