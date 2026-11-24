import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCmsTableMissing } from '@/lib/cms/safe'
import { PostForm, type PostFormValues } from '../_components/post-form'
import { NotMigratedNotice } from '../_components/not-migrated-notice'
import { loadCategoryOptions } from '../_components/load-categories'

type Params = Promise<{ locale: string; id: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'adminBlog' })
  return { title: t('form.editTitle') }
}

export default async function EditBlogPostPage({ params }: { params: Params }) {
  const { locale, id } = await params
  const session = await auth()
  if (!session?.user?.isGlobalAdmin) redirect(`/${locale}/login/admin?error=forbidden`)

  let post
  let categories
  try {
    ;[post, categories] = await Promise.all([
      prisma.blogPost.findUnique({ where: { id } }),
      loadCategoryOptions(locale),
    ])
  } catch (error) {
    if (isCmsTableMissing(error)) return <NotMigratedNotice />
    throw error
  }
  if (!post) notFound()

  const values: PostFormValues = {
    id: post.id,
    locale: post.locale,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    body: post.body,
    coverImage: post.coverImage,
    categoryId: post.categoryId,
    tags: post.tags,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    status: post.status,
    publishedAt: post.publishedAt?.toISOString() ?? null,
  }

  // key: remount the form with fresh values after router.refresh() following a save.
  return (
    <PostForm
      key={post.updatedAt.toISOString()}
      locale={locale}
      categories={categories}
      post={values}
    />
  )
}
