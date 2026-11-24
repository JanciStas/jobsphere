import { prisma } from '@/lib/prisma'
import { categoryName } from '@/lib/blog/shared'

/** Category options for the post form, labelled in the admin's UI locale. */
export async function loadCategoryOptions(locale: string) {
  const rows = await prisma.blogCategory.findMany({
    select: { id: true, slug: true, names: true },
    orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
  })
  return rows.map((c) => ({ id: c.id, label: categoryName(c.names, locale, c.slug) }))
}
