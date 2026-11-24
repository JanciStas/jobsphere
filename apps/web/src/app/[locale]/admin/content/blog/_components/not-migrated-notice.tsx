import { getTranslations } from 'next-intl/server'

/** Shown instead of the blog admin while the CMS migration is not applied. */
export async function NotMigratedNotice() {
  const t = await getTranslations('adminBlog')
  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
    >
      {t('notMigrated')}
    </div>
  )
}
