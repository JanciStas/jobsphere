import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { AdminShell } from '@/components/admin/admin-shell'

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  const session = await auth()

  if (!session?.user?.id) {
    redirect(`/${params.locale}/login/admin`)
  }

  // Server-side check on every render; the middleware is only the first line of defence.
  if (!session.user.isGlobalAdmin) {
    redirect(`/${params.locale}/login/admin?error=forbidden`)
  }

  return <AdminShell locale={params.locale}>{children}</AdminShell>
}
