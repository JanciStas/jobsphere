import Link from 'next/link'
import Image from 'next/image'
import { useTranslations, useLocale } from 'next-intl'

export function Footer() {
  const t = useTranslations('footer')
  const locale = useLocale()

  const footerSections = [
    {
      title: t('forCandidates'),
      links: [
        { label: t('browseJobs'), href: `/${locale}/jobs` },
        { label: t('createCV'), href: `/${locale}/create-cv` },
        { label: t('careerAdvice'), href: `/${locale}/career-advice` },
      ],
    },
    {
      title: t('forEmployers'),
      links: [
        { label: t('postJob'), href: `/${locale}/post-job` },
        { label: t('pricing'), href: `/${locale}/pricing` },
        { label: t('atsFeatures'), href: `/${locale}/features` },
      ],
    },
    {
      title: t('company'),
      links: [
        { label: t('about'), href: `/${locale}/about` },
        { label: t('contact'), href: `/${locale}/contact` },
        { label: t('blog'), href: `/${locale}/blog` },
      ],
    },
    {
      title: t('legal'),
      links: [
        { label: t('privacy'), href: `/${locale}/privacy` },
        { label: t('terms'), href: `/${locale}/terms` },
        { label: t('gdpr'), href: `/${locale}/gdpr` },
      ],
    },
  ]

  return (
    <footer className="border-t bg-muted/30">
      <div className="container py-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-5">
          <div className="col-span-2 md:col-span-1">
            <Image
              src="/images/jobsphere_logo.png"
              alt="JobSphere"
              width={120}
              height={40}
              className="h-8 w-auto"
            />
            <p className="mt-2 text-sm text-muted-foreground">{t('tagline')}</p>
          </div>
          {footerSections.map((section, index) => (
            <div key={index}>
              <h3 className="mb-2 text-sm font-semibold">{section.title}</h3>
              <ul className="space-y-1.5">
                {section.links.map((link, linkIndex) => (
                  <li key={linkIndex}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-primary"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-6 border-t pt-4 text-center text-xs text-muted-foreground md:text-left">
          © {new Date().getFullYear()} JobSphere. {t('allRightsReserved')}
        </p>
      </div>
    </footer>
  )
}
