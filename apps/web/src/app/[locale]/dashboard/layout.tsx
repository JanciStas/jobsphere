import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { CandidateShell } from './candidate-shell'

/**
 * Server-side auth guard (defense-in-depth) for the /dashboard segment.
 *
 * The app also protects these routes via middleware (apps/web/src/middleware.ts),
 * but CVE-2025-29927 demonstrated that Next.js middleware can be bypassed. This
 * layout enforces authentication inside the route tree so the guard runs even if
 * middleware is skipped. Mirrors the pattern in admin/layout.tsx and
 * employer/layout.tsx.
 */
export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  const session = await auth()

  if (!session?.user?.id) {
    redirect(`/${params.locale}/login/candidate`)
  }

  return <CandidateShell locale={params.locale}>{children}</CandidateShell>
}
