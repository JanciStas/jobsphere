import { redirect } from 'next/navigation'

export default async function FreelancerIndexPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  redirect(`/${locale}/freelancer/dashboard`)
}
