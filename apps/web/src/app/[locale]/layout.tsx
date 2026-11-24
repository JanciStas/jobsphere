import { Inter } from 'next/font/google'
import { notFound } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'
import { SessionProvider } from '@/components/providers/session-provider'
import { Header } from '@/components/layout/header'
import { AnnouncementBar } from '@/components/layout/announcement-bar'
import { Footer } from '@/components/layout/footer'
import { SkipNav } from '@/components/layout/skip-nav'
import { locales } from '@/config/i18n'
import { Analytics } from '@vercel/analytics/react'
import '@/styles/globals.css'

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-sans',
})

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }) {
  const t = await getTranslations({ locale, namespace: 'metadata' })

  return {
    title: {
      template: `%s | ${t('siteName')}`,
      default: t('siteName'),
    },
    description: t('description'),
    keywords: t('keywords'),
    authors: [{ name: 'JobSphere Team' }],
    creator: 'JobSphere',
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
    openGraph: {
      type: 'website',
      locale: locale,
      url: '/',
      siteName: t('siteName'),
      title: t('siteName'),
      description: t('description'),
      images: [
        {
          url: '/og-image.png',
          width: 1200,
          height: 630,
          alt: t('siteName'),
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: t('siteName'),
      description: t('description'),
      images: ['/og-image.png'],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        'max-video-preview': -1,
        'max-image-preview': 'large',
        'max-snippet': -1,
      },
    },
  }
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  if (!locales.includes(locale as any)) {
    notFound()
  }

  const messages = await getMessages()

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link rel="alternate" hrefLang="x-default" href="/" />
        {locales.map((l) => (
          <link key={l} rel="alternate" hrefLang={l} href={`/${l}`} />
        ))}
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <SessionProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
          >
            <NextIntlClientProvider locale={locale} messages={messages}>
              <SkipNav />
              <div className="relative flex min-h-screen flex-col">
                <AnnouncementBar locale={locale} />
                <Header />
                <main id="main-content" className="flex-1" role="main" tabIndex={-1}>
                  {children}
                </main>
                <Footer />
              </div>
              <Toaster />
            </NextIntlClientProvider>
          </ThemeProvider>
        </SessionProvider>
        <Analytics />
      </body>
    </html>
  )
}
