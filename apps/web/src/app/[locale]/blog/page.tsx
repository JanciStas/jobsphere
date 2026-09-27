import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('blog.title'),
    description: t('blog.description'),
  }
}

export default async function BlogPage({ params: { locale } }: { params: { locale: string } }) {
  const t = await getTranslations('blog')
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-6 text-3xl font-bold">{t('title')}</h1>
      <p className="mb-8 text-muted-foreground">{t('comingSoon')}</p>
      <Link
        href={`/${locale}/jobs`}
        className="inline-flex items-center text-primary hover:underline"
      >
        {t('browseJobs')} →
      </Link>
    </main>
  )
}
