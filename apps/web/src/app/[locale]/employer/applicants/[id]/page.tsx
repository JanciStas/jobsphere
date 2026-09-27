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
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft,
  Mail,
  Phone,
  Download,
  MapPin,
  Euro,
  Clock,
  Building2,
  ArrowRight,
  StickyNote,
  FileText,
  CalendarClock,
  Video,
} from 'lucide-react'
import { ApplicantActions } from '@/components/applicant-actions'
import { ApplicantSummaryCard } from '@/components/employer/applicant-summary-card'
import { APPLICATION_STAGES, STAGE_COLORS } from '@/lib/constants/application-stages'
import { LONG_DATE, SHORT_DATE } from '@/lib/formats'

// ---- helpers ----

function activityIcon(type: string) {
  if (type === 'EMAIL_SENT' || type === 'EMAIL_RECEIVED') return <Mail className="h-4 w-4" />
  if (type === 'STAGE_CHANGE' || type === 'STAGE_CHANGED') return <ArrowRight className="h-4 w-4" />
  if (type === 'NOTE_ADDED') return <StickyNote className="h-4 w-4" />
  if (type === 'INTERVIEW_SCHEDULED') return <CalendarClock className="h-4 w-4" />
  return <FileText className="h-4 w-4" />
}

interface ParsedResume {
  summary?: string
  skills?: string[]
  yearsOfExperience?: number
  experiences?: Array<{
    title?: string
    company?: string
    startDate?: string
    endDate?: string
    current?: boolean
    description?: string
  }>
  education?: Array<{
    institution?: string
    field?: string
    degree?: string
    startDate?: string
    endDate?: string
  }>
}

function safeParseResume(
  resume: {
    summary?: string | null
    skills: string[]
    yearsOfExperience?: number | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    experiences: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    education: any
  } | null,
): ParsedResume | null {
  if (!resume) return null
  try {
    // Normalize both shapes the Resume JSON can hold: the builder/upload shape
    // ({position, period, school, year}) and the already-normalized employer shape
    // ({title, startDate, institution, endDate}) copied in via copyProfileCvToCandidate.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const experiences = (Array.isArray(resume.experiences) ? resume.experiences : []).map(
      (e: any) => ({
        title: e.title ?? e.position ?? undefined,
        company: e.company ?? undefined,
        startDate: e.startDate ?? e.period ?? undefined,
        endDate: e.endDate ?? undefined,
        current: e.current ?? undefined,
        description: e.description ?? undefined,
      }),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const education = (Array.isArray(resume.education) ? resume.education : []).map((e: any) => ({
      institution: e.institution ?? e.school ?? undefined,
      field: e.field ?? undefined,
      degree: e.degree ?? undefined,
      startDate: e.startDate ?? undefined,
      endDate: e.endDate ?? e.year ?? undefined,
    }))
    return {
      summary: resume.summary ?? undefined,
      skills: Array.isArray(resume.skills) ? resume.skills : [],
      yearsOfExperience: resume.yearsOfExperience ?? undefined,
      experiences,
      education,
    }
  } catch {
    return null
  }
}

// ---- data fetching ----

async function getApplicationDetail(
  applicationId: string,
  userId: string,
  activeOrgId?: string | null,
) {
  const userOrgRole = await resolveActiveMembership(userId, activeOrgId)
  if (!userOrgRole) return null

  const application = await prisma.application.findFirst({
    where: {
      id: applicationId,
      // Tenant boundary: Application.orgId is a non-nullable column always written
      // as job.orgId on create, so this is equivalent to `job: { orgId }` without the join.
      orgId: userOrgRole.orgId,
    },
    include: {
      job: {
        include: { organization: true },
      },
      candidate: {
        include: {
          contacts: {
            where: { isPrimary: true },
            take: 1,
          },
          resumes: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { sourceDocument: true },
          },
        },
      },
      activities: {
        orderBy: { createdAt: 'asc' },
      },
      interviews: {
        orderBy: { scheduledAt: 'asc' },
      },
    },
  })

  if (!application) return null

  // Defensive MatchScore fetch — model exists per schema
  let matchScore: {
    score0to100: number
    overrideScore: number | null
    evidence: unknown
    explanation: string[]
  } | null = null
  try {
    matchScore = await prisma.matchScore.findUnique({
      where: {
        jobId_candidateId: {
          jobId: application.jobId,
          candidateId: application.candidateId,
        },
      },
      select: { score0to100: true, overrideScore: true, evidence: true, explanation: true },
    })
  } catch {
    matchScore = null
  }

  return { application, matchScore, orgId: userOrgRole.orgId }
}

// ---- metadata ----

export async function generateMetadata({
  params,
}: {
  params: { locale: string }
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: 'employer.applicantDetail' })
  return {
    title: t('title'),
    description: t('metaDescription'),
  }
}

// ---- page ----

export default async function EmployerApplicationDetailPage({
  params,
}: {
  params: { locale: string; id: string }
}) {
  const session = await auth()
  if (!session?.user?.id) {
    redirect(`/${params.locale}/login`)
  }

  const format = await getFormatter()
  const t = await getTranslations({ locale: params.locale, namespace: 'employer' })
  const tStages = await getTranslations({ locale: params.locale, namespace: 'employer.stages' })
  const tDetail = await getTranslations({
    locale: params.locale,
    namespace: 'employer.applicantDetail',
  })

  // Locale-aware date helpers, bound to the formatter for this request.
  const relativeTime = (date: Date) => format.relativeTime(date, Date.now())
  const dayLabel = (date: Date) => format.dateTime(date, LONG_DATE)
  const formatInterviewDateTime = (date: Date) =>
    format.dateTime(new Date(date), { ...LONG_DATE, hour: '2-digit', minute: '2-digit' })

  const result = await getApplicationDetail(params.id, session.user.id, session.user.activeOrgId)
  if (!result) {
    redirect(`/${params.locale}/employer/applicants`)
  }

  const { application, matchScore } = result
  const contact = application.candidate.contacts?.[0] ?? null
  const latestResume = application.candidate.resumes?.[0] ?? null
  const parsedResume = safeParseResume(latestResume)

  const getStatusBadge = (stage: string) => {
    const label = (APPLICATION_STAGES as readonly string[]).includes(stage) ? tStages(stage) : stage
    const colorClass = STAGE_COLORS[stage as keyof typeof STAGE_COLORS]
    if (colorClass) return <Badge className={colorClass}>{label}</Badge>
    return <Badge>{label}</Badge>
  }

  // Group activities by day
  const activitiesByDay: Map<string, typeof application.activities> = new Map()
  for (const activity of application.activities) {
    const dayKey = dayLabel(new Date(activity.createdAt))
    const existing = activitiesByDay.get(dayKey) ?? []
    existing.push(activity)
    activitiesByDay.set(dayKey, existing)
  }

  const hasAiData =
    parsedResume &&
    ((parsedResume.summary && parsedResume.summary.length > 0) ||
      (parsedResume.skills && parsedResume.skills.length > 0) ||
      (parsedResume.experiences && parsedResume.experiences.length > 0) ||
      (parsedResume.education && parsedResume.education.length > 0))

  // Parse match score evidence for sub-scores
  let evidenceBreakdown: Record<string, number> | null = null
  try {
    if (matchScore?.evidence && typeof matchScore.evidence === 'object') {
      const ev = matchScore.evidence as Record<string, unknown>
      const keys = ['skillsMatch', 'experienceMatch', 'educationMatch']
      const result: Record<string, number> = {}
      for (const k of keys) {
        if (typeof ev[k] === 'number') result[k] = ev[k] as number
      }
      if (Object.keys(result).length > 0) evidenceBreakdown = result
    }
  } catch {
    evidenceBreakdown = null
  }

  const breakdownLabels: Record<string, string> = {
    skillsMatch: tDetail('skills'),
    experienceMatch: tDetail('experience'),
    educationMatch: tDetail('education'),
  }

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

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-8">
        <Button variant="ghost" asChild className="mb-6">
          <Link href={`/${params.locale}/employer/applicants`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {tDetail('back')}
          </Link>
        </Button>

        {/* Summary card — top of page */}
        <div className="mb-6">
          <ApplicantSummaryCard
            contact={
              contact
                ? {
                    fullName: contact.fullName ?? null,
                    email: contact.email ?? null,
                    phone: contact.phone ?? null,
                    location: contact.location ?? null,
                    city: contact.city ?? null,
                    country: contact.country ?? null,
                  }
                : null
            }
            resume={
              parsedResume
                ? {
                    skills: parsedResume.skills ?? [],
                    yearsOfExperience: parsedResume.yearsOfExperience ?? null,
                    summary: parsedResume.summary ?? null,
                  }
                : null
            }
            matchScore={
              matchScore
                ? { score0to100: matchScore.score0to100, overrideScore: matchScore.overrideScore }
                : null
            }
            applicationId={application.id}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="space-y-6 lg:col-span-2">
            {/* Job Info */}
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <CardTitle className="mb-2 text-2xl">{application.job.title}</CardTitle>
                    <CardDescription className="text-base">
                      {application.job.organization.name}
                    </CardDescription>
                  </div>
                  {getStatusBadge(application.stage)}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {application.job.city && (
                    <div className="flex items-center gap-2 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {application.job.city}
                        {application.job.region ? `, ${application.job.region}` : ''}
                      </span>
                    </div>
                  )}
                  {application.job.salaryMin && application.job.salaryMax && (
                    <div className="flex items-center gap-2 text-sm">
                      <Euro className="h-4 w-4 text-muted-foreground" />
                      <span>
                        {tDetail('salaryPerMonth', {
                          range: `${application.job.salaryMin} - ${application.job.salaryMax}`,
                        })}
                      </span>
                    </div>
                  )}
                  {(application.job.remote || application.job.hybrid) && (
                    <div className="flex items-center gap-2 text-sm">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span>{application.job.remote ? 'Remote' : 'Hybrid'}</span>
                    </div>
                  )}
                  {application.job.employmentType && (
                    <div className="flex items-center gap-2 text-sm">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>{application.job.employmentType.replace('_', ' ')}</span>
                    </div>
                  )}
                </div>
                <Separator />
                <div className="text-sm text-muted-foreground">
                  {t('applied')} {format.dateTime(application.createdAt, SHORT_DATE)}
                </div>
              </CardContent>
            </Card>

            {/* AI Parsed CV */}
            <Card>
              <CardHeader>
                <CardTitle>{tDetail('parsedCv')}</CardTitle>
                <CardDescription>{tDetail('parsedCvDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {!hasAiData ? (
                  <p className="text-sm text-muted-foreground">{tDetail('parsedCvEmpty')}</p>
                ) : (
                  <>
                    {parsedResume?.summary && (
                      <div>
                        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                          {tDetail('summary')}
                        </h3>
                        <p className="text-sm leading-relaxed">{parsedResume.summary}</p>
                      </div>
                    )}

                    {parsedResume?.skills && parsedResume.skills.length > 0 && (
                      <div>
                        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                          {tDetail('skills')}
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {parsedResume.skills.map((skill) => (
                            <Badge key={skill} variant="secondary" className="text-xs">
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {parsedResume?.experiences && parsedResume.experiences.length > 0 && (
                      <div>
                        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                          {tDetail('experience')}
                        </h3>
                        <div className="space-y-4">
                          {parsedResume.experiences.map((exp, i) => (
                            <div key={i} className="border-l-2 border-primary/30 pl-4">
                              <p className="font-medium">
                                {exp.title ?? tDetail('positionFallback')}
                              </p>
                              {exp.company && (
                                <p className="text-sm text-muted-foreground">{exp.company}</p>
                              )}
                              {(exp.startDate || exp.endDate || exp.current) && (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {[exp.startDate, exp.current ? tDetail('present') : exp.endDate]
                                    .filter(Boolean)
                                    .join(' – ')}
                                </p>
                              )}
                              {exp.description && <p className="mt-1 text-sm">{exp.description}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {parsedResume?.education && parsedResume.education.length > 0 && (
                      <div>
                        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                          {tDetail('education')}
                        </h3>
                        <div className="space-y-3">
                          {parsedResume.education.map((edu, i) => (
                            <div key={i} className="border-l-2 border-muted pl-4">
                              <p className="font-medium">
                                {edu.institution ?? tDetail('schoolFallback')}
                              </p>
                              {(edu.field || edu.degree) && (
                                <p className="text-sm text-muted-foreground">
                                  {[edu.degree, edu.field].filter(Boolean).join(' – ')}
                                </p>
                              )}
                              {(edu.startDate || edu.endDate) && (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {[edu.startDate, edu.endDate].filter(Boolean).join(' – ')}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Match Score Breakdown */}
            {matchScore && (
              <Card>
                <CardHeader>
                  <CardTitle>{tDetail('matchTitle')}</CardTitle>
                  <CardDescription className="flex items-center gap-2">
                    <span>
                      {tDetail('overallScoreValue', {
                        score: matchScore.overrideScore ?? matchScore.score0to100,
                      })}
                    </span>
                    {matchScore.overrideScore != null && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">
                        {tDetail('hrOverride', { score: matchScore.score0to100 })}
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {evidenceBreakdown ? (
                    Object.entries(evidenceBreakdown).map(([key, value]) => (
                      <div key={key}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span>{breakdownLabels[key] ?? key}</span>
                          <span className="font-medium">{value}%</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div>
                      <div className="mb-1 flex justify-between text-sm">
                        <span>{tDetail('overallScore')}</span>
                        <span className="font-medium">
                          {matchScore.overrideScore ?? matchScore.score0to100}%
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.max(0, matchScore.overrideScore ?? matchScore.score0to100),
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {matchScore.explanation && matchScore.explanation.length > 0 && (
                    <ul className="mt-4 space-y-1">
                      {matchScore.explanation.map((point, i) => (
                        <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                          {point}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Interviews */}
            <Card>
              <CardHeader>
                <CardTitle>{tDetail('interviews')}</CardTitle>
                <CardDescription>{tDetail('interviewsDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                {application.interviews.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{tDetail('noInterviews')}</p>
                ) : (
                  <div className="space-y-3">
                    {application.interviews.map((interview) => (
                      <div
                        key={interview.id}
                        className="flex items-start gap-3 rounded-lg border p-4"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          {interview.type === 'VIDEO' ? (
                            <Video className="h-4 w-4" />
                          ) : (
                            <CalendarClock className="h-4 w-4" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-medium">
                              {interviewTypeLabels[interview.type] ?? interview.type}
                            </p>
                            <Badge variant="outline" className="text-xs">
                              {interviewStatusLabels[interview.status] ?? interview.status}
                            </Badge>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {formatInterviewDateTime(interview.scheduledAt)}
                            {interview.durationMin ? ` · ${interview.durationMin} min` : ''}
                          </p>
                          {interview.location && (
                            <p className="mt-1 flex items-center gap-1 text-sm">
                              <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                              {interview.location}
                            </p>
                          )}
                          {interview.meetingUrl && (
                            <a
                              href={interview.meetingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                            >
                              <Video className="h-3.5 w-3.5" />
                              {t('joinCall')}
                            </a>
                          )}
                          {interview.notes && (
                            <p className="mt-2 whitespace-pre-wrap text-sm">{interview.notes}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cover Letter */}
            <Card>
              <CardHeader>
                <CardTitle>{tDetail('coverLetter')}</CardTitle>
              </CardHeader>
              <CardContent>
                {application.coverLetter ? (
                  <div className="whitespace-pre-wrap text-sm">{application.coverLetter}</div>
                ) : (
                  <p className="text-sm text-muted-foreground">{tDetail('coverLetterEmpty')}</p>
                )}
              </CardContent>
            </Card>

            {/* Timeline */}
            <Card>
              <CardHeader>
                <CardTitle>{tDetail('timeline')}</CardTitle>
                <CardDescription>{tDetail('timelineDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                {application.activities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{tDetail('noActivities')}</p>
                ) : (
                  <div className="space-y-6">
                    {Array.from(activitiesByDay.entries()).map(([day, acts]) => (
                      <div key={day}>
                        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {day}
                        </p>
                        <div className="space-y-4">
                          {acts.map((activity, index) => (
                            <div key={activity.id} className="flex gap-4">
                              <div className="flex flex-col items-center">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                  {activityIcon(activity.type)}
                                </div>
                                {index !== acts.length - 1 && (
                                  <div className="mt-2 w-px flex-1 bg-border" />
                                )}
                              </div>
                              <div className="flex-1 pb-2">
                                <p className="font-medium">{activity.type.replace(/_/g, ' ')}</p>
                                <p className="text-sm text-muted-foreground">
                                  {activity.description}
                                </p>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {relativeTime(new Date(activity.createdAt))}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Candidate Contact */}
            <Card>
              <CardHeader>
                <CardTitle>{t('candidate')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-lg font-semibold">
                    {contact?.fullName ?? contact?.email ?? t('candidate')}
                  </p>
                  <div className="mt-3 space-y-2">
                    {contact?.email && (
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <a
                          href={`mailto:${contact.email}`}
                          className="text-primary hover:underline"
                        >
                          {contact.email}
                        </a>
                      </div>
                    )}
                    {contact?.phone && (
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <a href={`tel:${contact.phone}`} className="hover:underline">
                          {contact.phone}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* CV Download */}
            {latestResume?.sourceDocument && (
              <Card>
                <CardHeader>
                  <CardTitle>{tDetail('resume')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Button asChild className="w-full">
                    <a
                      href={`/api/cv/${latestResume.sourceDocument.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      {latestResume.sourceDocument.filename || tDetail('downloadCv')}
                    </a>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Actions */}
            <ApplicantActions
              applicationId={application.id}
              currentStage={application.stage}
              locale={params.locale}
            />

            {/* Notes */}
            {(() => {
              const n = application.notes
              const notesArray: Array<{
                text: string
                createdByName?: string
                createdAt?: string
              }> = (() => {
                if (!n) return []
                if (typeof n === 'string') return [{ text: n }]
                if (Array.isArray(n)) {
                  return n.map((item) => {
                    if (typeof item === 'string') return { text: item }
                    if (item && typeof item === 'object')
                      return item as { text: string; createdByName?: string; createdAt?: string }
                    return { text: String(item) }
                  })
                }
                if (typeof n === 'object') {
                  return [n as { text: string; createdByName?: string; createdAt?: string }]
                }
                return []
              })()

              if (notesArray.length === 0) return null

              return (
                <Card>
                  <CardHeader>
                    <CardTitle>{tDetail('notes')}</CardTitle>
                    <CardDescription>{tDetail('notesDesc')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {notesArray.map((note, index) => (
                        <div key={index} className="border-l-2 border-primary/30 py-2 pl-3">
                          <p className="whitespace-pre-wrap text-sm">{note.text}</p>
                          {(note.createdByName || note.createdAt) && (
                            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                              {note.createdByName && <span>{note.createdByName}</span>}
                              {note.createdByName && note.createdAt && <span>•</span>}
                              {note.createdAt && (
                                <span>{format.dateTime(new Date(note.createdAt), SHORT_DATE)}</span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}
