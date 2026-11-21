import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'

/**
 * Per-page session guard for the freelancer area. The layout guard alone is not enough:
 * layouts are not re-run on client-side navigation, so a page that trusted it would query
 * with `userId: undefined` — which Prisma treats as "no filter" and returns every row.
 */
export async function requireFreelancerUserId(locale: string): Promise<string> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) {
    redirect(`/${locale}/login/freelancer`)
  }
  return userId
}
