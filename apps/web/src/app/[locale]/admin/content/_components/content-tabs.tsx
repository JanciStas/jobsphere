'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'

export const CONTENT_TABS = ['pages', 'faq', 'texts', 'blog', 'announcements'] as const

export function ContentTabs({ locale }: { locale: string }) {
  const t = useTranslations('adminContent.tabs')
  const pathname = usePathname()
  return (
    <nav aria-label={t('label')} className="flex flex-wrap gap-1 border-b">
      {CONTENT_TABS.map((tab) => {
        const href = `/${locale}/admin/content/${tab}`
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={tab}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(tab)}
          </Link>
        )
      })}
    </nav>
  )
}
