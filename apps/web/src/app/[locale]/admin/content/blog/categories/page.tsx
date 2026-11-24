import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCmsTableMissing } from '@/lib/cms/safe'
import { CMS_LOCALES } from '@/lib/cms/constants'
import { CategoriesManager, type CategoryRow } from '../_components/categories-manager'
import { NotMigratedNotice } from '../_components/not-migrated-notice'

type Params = Promise<{ locale: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminBlog' })
  return { title: t('categories.title') }
}

export default async function BlogCategoriesPage({ params }: { params: Params }) {
  const { locale } = await params
  const session = await auth()
  if (!session?.user?.isGlobalAdmin) redirect(`/${locale}/login/admin?error=forbidden`)
  const t = await getTranslations({ locale, namespace: 'adminBlog' })

  let rows
  try {
    rows = await prisma.blogCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      include: { _count: { select: { posts: true } } },
    })
  } catch (error) {
    if (isCmsTableMissing(error)) return <NotMigratedNotice />
    throw error
  }

  const categories: CategoryRow[] = rows.map((c) => {
    const raw = c.names && typeof c.names === 'object' && !Array.isArray(c.names) ? c.names : {}
    const names = Object.fromEntries(
      CMS_LOCALES.map((l) => {
        const value = (raw as Record<string, unknown>)[l]
        return [l, typeof value === 'string' ? value : '']
      }),
    )
    return { id: c.id, slug: c.slug, names, postCount: c._count.posts }
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{t('categories.title')}</h2>
        <Link
          href={`/${locale}/admin/content/blog`}
          className="text-sm text-muted-foreground hover:text-primary"
        >
          ← {t('categories.backToPosts')}
        </Link>
      </div>
      <CategoriesManager locale={locale} initial={categories} />
    </div>
  )
}
