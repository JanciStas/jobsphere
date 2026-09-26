import { getTranslations } from 'next-intl/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { prisma } from '@/lib/prisma'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Building2 } from 'lucide-react'
import { logger } from '@/lib/logger'

export const revalidate = 3600 // Revalidate company directory every hour

export async function generateMetadata({
  params: { locale },
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'pageMetadata' })
  return {
    title: t('companies.title'),
    description: t('companies.description'),
  }
}

async function getCompanies() {
  try {
    return await prisma.organization.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        logo: true,
        description: true,
        industry: true,
        _count: {
          select: {
            jobs: { where: { status: 'PUBLISHED', deletedAt: null } },
          },
        },
      },
      orderBy: { name: 'asc' },
      take: 60,
    })
  } catch (error) {
    logger.error('Error fetching companies', error)
    return []
  }
}

export default async function CompaniesPage({ params }: { params: { locale: string } }) {
  const companies = await getCompanies()

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="mb-2 text-4xl font-bold">Profily firiem</h1>
          <p className="text-muted-foreground">
            Objavte firmy, ktoré na JobSphere hľadajú nových kolegov.
          </p>
        </div>

        {companies.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground" />
            <p className="text-lg text-muted-foreground">Zatiaľ tu nie sú žiadne firmy.</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {companies.map((company) => {
              const initial = company.name?.trim().charAt(0).toUpperCase() || '?'
              return (
                <Link
                  key={company.id}
                  href={`/${params.locale}/company/${company.id}`}
                  className="group"
                >
                  <Card className="flex h-full flex-col transition-shadow group-hover:shadow-lg">
                    <CardHeader>
                      <div className="flex items-center gap-4">
                        {company.logo ? (
                          <Image
                            src={company.logo}
                            alt={company.name}
                            width={56}
                            height={56}
                            className="h-14 w-14 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary/10 text-xl font-bold text-primary">
                            {initial}
                          </div>
                        )}
                        <div className="space-y-1">
                          <CardTitle className="line-clamp-1 text-lg">{company.name}</CardTitle>
                          {company.industry && (
                            <Badge variant="secondary" className="w-fit">
                              {company.industry}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1 space-y-3">
                      {company.description && (
                        <p className="line-clamp-3 text-sm text-muted-foreground">
                          {company.description}
                        </p>
                      )}
                      <p className="text-sm font-medium text-primary">
                        {company._count.jobs}{' '}
                        {company._count.jobs === 1 ? 'otvorená pozícia' : 'otvorených pozícií'}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
