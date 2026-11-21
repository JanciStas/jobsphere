import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Euro, Clock, Building2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('gigs.title'),
    description: t('gigs.description'),
  }
}

type SearchParams = Record<string, string | string[] | undefined>

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const toBudget = (v: string | undefined) => {
  if (!v || !/^\d{1,8}$/.test(v)) return undefined
  return parseInt(v, 10)
}

export default async function GigsPage({
  params,
  searchParams,
}: {
  params: { locale: string }
  searchParams?: SearchParams
}) {
  const t = await getTranslations({ locale: params.locale, namespace: 'agencyDashboard' })
  const q = (first(searchParams?.q) ?? '').trim().slice(0, 100)
  const minBudget = toBudget(first(searchParams?.minBudget))
  const maxBudget = toBudget(first(searchParams?.maxBudget))

  const gigs = await prisma.gig.findMany({
    where: {
      status: 'OPEN',
      // Suspended organizations (admin) disappear from the public marketplace.
      organization: { deletedAt: null },
      ...(q ? { title: { contains: q, mode: 'insensitive' as const } } : {}),
      ...(minBudget !== undefined || maxBudget !== undefined
        ? { budget: { gte: minBudget, lte: maxBudget } }
        : {}),
    },
    select: {
      id: true,
      title: true,
      description: true,
      budget: true,
      currency: true,
      durationDays: true,
      organization: { select: { name: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 60,
  })
  const filtered = q !== '' || minBudget !== undefined || maxBudget !== undefined

  return (
    <div className="min-h-screen bg-muted/30 py-10">
      <div className="container mx-auto max-w-4xl px-4">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold sm:text-4xl">{t('public.title')}</h1>
          <p className="mt-2 text-muted-foreground">{t('public.subtitle')}</p>
        </div>

        <form
          method="get"
          className="mb-6 grid gap-3 rounded-lg border bg-background p-4 sm:grid-cols-[1fr_8rem_8rem_auto]"
        >
          <Input
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder={t('public.searchPlaceholder')}
            aria-label={t('public.searchPlaceholder')}
          />
          <Input
            name="minBudget"
            type="number"
            min={0}
            defaultValue={minBudget}
            placeholder={t('public.minBudget')}
            aria-label={t('public.minBudget')}
          />
          <Input
            name="maxBudget"
            type="number"
            min={0}
            defaultValue={maxBudget}
            placeholder={t('public.maxBudget')}
            aria-label={t('public.maxBudget')}
          />
          <div className="flex gap-2">
            <Button type="submit">{t('public.filter')}</Button>
            {filtered && (
              <Button variant="ghost" asChild>
                <Link href={`/${params.locale}/gigs`}>{t('public.reset')}</Link>
              </Button>
            )}
          </div>
        </form>

        {gigs.length === 0 ? (
          <div className="rounded-lg border bg-background p-12 text-center text-muted-foreground">
            {filtered ? t('public.emptyFiltered') : t('public.empty')}{' '}
            <Link href={`/${params.locale}/freelancer`} className="text-primary hover:underline">
              {t('public.completeProfile')}
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            {gigs.map((gig) => (
              <Card key={gig.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-xl">
                        <Link href={`/${params.locale}/gigs/${gig.id}`} className="hover:underline">
                          {gig.title}
                        </Link>
                      </CardTitle>
                      <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                        <Building2 className="h-4 w-4" aria-hidden="true" />
                        {gig.organization.name}
                      </p>
                    </div>
                    <Badge>{t('status.OPEN')}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                    {gig.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    {gig.budget != null && (
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <Euro className="h-4 w-4" aria-hidden="true" />
                        {gig.budget} {gig.currency}
                      </span>
                    )}
                    {gig.durationDays != null && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" aria-hidden="true" />
                        {t('common.days', { count: gig.durationDays })}
                      </span>
                    )}
                  </div>
                  <Button size="sm" asChild>
                    <Link href={`/${params.locale}/gigs/${gig.id}`}>{t('public.viewDetail')}</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
