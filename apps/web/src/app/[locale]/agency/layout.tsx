import { requireAgency } from './_lib/agency-context'
import { AgencyShell } from './agency-shell'

/**
 * Server-side guard (defense-in-depth next to middleware) + shared dashboard frame.
 */
export default async function AgencyLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  await requireAgency(params.locale)
  return <AgencyShell locale={params.locale}>{children}</AgencyShell>
}
