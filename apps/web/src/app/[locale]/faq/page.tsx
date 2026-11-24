import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ChevronDown } from 'lucide-react'
import { CmsContent } from '@/components/cms/cms-content'
import { Button } from '@/components/ui/button'
import { buildFaqJsonLd, getPublishedFaq, groupFaqByCategory } from '@/lib/cms/faq'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'faqPage' })
  return { title: t('metaTitle'), description: t('metaDescription') }
}

export default async function FaqPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'faqPage' })
  const items = await getPublishedFaq(locale)
  const groups = groupFaqByCategory(items)

  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-3 text-3xl font-bold">{t('title')}</h1>
      <p className="mb-10 text-lg text-muted-foreground">{t('subtitle')}</p>

      {groups.length === 0 ? (
        <div className="rounded-lg border bg-muted/30 p-8 text-center">
          <p className="mb-4 text-muted-foreground">{t('empty')}</p>
          <Button asChild>
            <Link href={`/${locale}/contact`}>{t('contactCta')}</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-10">
            {groups.map((group) => (
              <section key={group.category} aria-labelledby={`faq-${group.category}`}>
                <h2 id={`faq-${group.category}`} className="mb-4 text-xl font-semibold">
                  {t(`categories.${group.category}`)}
                </h2>
                <div className="divide-y rounded-lg border">
                  {group.items.map((item) => (
                    <details key={item.id} className="group px-4">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                        <span>{item.question}</span>
                        <ChevronDown
                          aria-hidden="true"
                          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                        />
                      </summary>
                      <div className="pb-4">
                        <CmsContent markdown={item.answer} />
                      </div>
                    </details>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <p className="mt-10 text-center text-muted-foreground">
            {t('stillQuestions')}{' '}
            <Link href={`/${locale}/contact`} className="font-medium text-primary hover:underline">
              {t('contactCta')}
            </Link>
          </p>

          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(buildFaqJsonLd(items)).replace(/</g, '\\u003c'),
            }}
          />
        </>
      )}
    </main>
  )
}
