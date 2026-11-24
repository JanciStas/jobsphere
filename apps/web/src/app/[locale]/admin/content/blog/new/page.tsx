import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { isCmsTableMissing } from '@/lib/cms/safe'
import { PostForm } from '../_components/post-form'
import { NotMigratedNotice } from '../_components/not-migrated-notice'
import { loadCategoryOptions } from '../_components/load-categories'

type Params = Promise<{ locale: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminBlog' })
  return { title: t('form.newTitle') }
}

export default async function NewBlogPostPage({ params }: { params: Params }) {
  const { locale } = await params
  const session = await auth()
  if (!session?.user?.isGlobalAdmin) redirect(`/${locale}/login/admin?error=forbidden`)

  let categories
  try {
    categories = await loadCategoryOptions(locale)
  } catch (error) {
    if (isCmsTableMissing(error)) return <NotMigratedNotice />
    throw error
  }

  return <PostForm locale={locale} categories={categories} />
}
