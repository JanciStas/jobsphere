import { redirect } from 'next/navigation'

export default function AgencyIndex({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/agency/dashboard`)
}
