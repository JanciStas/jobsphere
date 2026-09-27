import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveActiveMembership } from '@/lib/api-helpers'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, CalendarClock, Video, MapPin, Phone } from 'lucide-react'
import { LONG_DATE, TIME_ONLY } from '@/lib/formats'

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'employer.calendar' })
  return {
    title: t('title'),
    description: t('metaDescription'),
  }
}

function typeIcon(type: string) {
  if (type === 'VIDEO') return <Video className="h-4 w-4" />
  if (type === 'PHONE') return <Phone className="h-4 w-4" />
  return <MapPin className="h-4 w-4" />
}

async function getInterviews(userId: string, activeOrgId?: string | null) {
  const userOrgRole = await resolveActiveMembership(userId, activeOrgId)
  if (!userOrgRole) return null

  // Upcoming interviews from the start of today onward, scoped to the caller's org.
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const interviews = await prisma.interview.findMany({
    where: {
      orgId: userOrgRole.orgId,
      scheduledAt: { gte: startOfToday },
    },
    include: {
      application: {
        select: {
          id: true,
          job: { select: { title: true } },
          candidate: {
            select: {
              contacts: {
                where: { isPrimary: true },
                take: 1,
                select: { fullName: true, email: true },
              },
            },
          },
        },
      },
    },
    orderBy: { scheduledAt: 'asc' },
  })

  return { interviews, orgId: userOrgRole.orgId }
}

export default async function EmployerCalendarPage({ params }: { params: { locale: string } }) {
  const session = await auth()
  if (!session?.user?.id) {
    redirect(`/${params.locale}/login`)
  }

  const result = await getInterviews(session.user.id, session.user.activeOrgId)
  if (!result) {
    redirect(`/${params.locale}/dashboard`)
  }

  const format = await getFormatter()
  const t = await getTranslations({ locale: params.locale, namespace: 'employer' })
  const tCalendar = await getTranslations({
    locale: params.locale,
    namespace: 'employer.calendar',
  })
  const dayLabel = (date: Date) =>
    format.dateTime(new Date(date), { weekday: 'long', ...LONG_DATE })
  const timeLabel = (date: Date) => format.dateTime(new Date(date), TIME_ONLY)

  // Enum -> label maps built from the catalog; an unknown enum value still falls
  // through to the raw value, exactly as before the i18n migration.
  const interviewTypeLabels: Record<string, string> = {
    VIDEO: t('interviewType.VIDEO'),
    ONSITE: t('interviewType.ONSITE'),
    PHONE: t('interviewType.PHONE'),
  }

  const interviewStatusLabels: Record<string, string> = {
    SCHEDULED: t('interviewStatus.SCHEDULED'),
    DONE: t('interviewStatus.DONE'),
    CANCELED: t('interviewStatus.CANCELED'),
  }

  const { interviews } = result

  // Group interviews by calendar day, preserving ascending order.
  const groups = new Map<string, typeof interviews>()
  for (const interview of interviews) {
    const key = dayLabel(interview.scheduledAt)
    const existing = groups.get(key) ?? []
    existing.push(interview)
    groups.set(key, existing)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto max-w-4xl px-4 py-8">
        <Button variant="ghost" asChild className="mb-6">
          <Link href={`/${params.locale}/employer`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('backToDashboard')}
          </Link>
        </Button>

        <div className="mb-8">
          <h1 className="mb-2 flex items-center gap-2 text-3xl font-bold">
            <CalendarClock className="h-7 w-7" />
            {tCalendar('title')}
          </h1>
          <p className="text-muted-foreground">{tCalendar('subtitle')}</p>
        </div>

        {interviews.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <CalendarClock className="mx-auto mb-3 h-12 w-12" />
              <p>{tCalendar('empty')}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {Array.from(groups.entries()).map(([day, dayInterviews]) => (
              <div key={day}>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {day}
                </h2>
                <div className="space-y-3">
                  {dayInterviews.map((interview) => {
                    const contact = interview.application.candidate.contacts?.[0]
                    const candidateName = contact?.fullName || contact?.email || t('candidate')
                    return (
                      <Card key={interview.id}>
                        <CardHeader className="pb-3">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <CardTitle className="flex items-center gap-2 text-base">
                                {typeIcon(interview.type)}
                                {candidateName}
                              </CardTitle>
                              <CardDescription>{interview.application.job.title}</CardDescription>
                            </div>
                            <div className="text-right">
                              <p className="font-semibold">{timeLabel(interview.scheduledAt)}</p>
                              {interview.durationMin && (
                                <p className="text-xs text-muted-foreground">
                                  {interview.durationMin} min
                                </p>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-2 pt-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {interviewTypeLabels[interview.type] ?? interview.type}
                            </Badge>
                            <Badge variant="secondary" className="text-xs">
                              {interviewStatusLabels[interview.status] ?? interview.status}
                            </Badge>
                          </div>
                          {interview.location && (
                            <p className="flex items-center gap-1 text-sm text-muted-foreground">
                              <MapPin className="h-3.5 w-3.5" />
                              {interview.location}
                            </p>
                          )}
                          {interview.meetingUrl && (
                            <a
                              href={interview.meetingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            >
                              <Video className="h-3.5 w-3.5" />
                              {t('joinCall')}
                            </a>
                          )}
                          <div>
                            <Button variant="outline" size="sm" asChild className="mt-1">
                              <Link
                                href={`/${params.locale}/employer/applicants/${interview.application.id}`}
                              >
                                {t('applicantDetail.title')}
                              </Link>
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
