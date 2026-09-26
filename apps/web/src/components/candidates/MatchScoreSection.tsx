'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { TrendingUp, Briefcase, AlertCircle, MapPin, Euro } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { logger } from '@/lib/logger'

interface MatchScore {
  jobId: string
  matchScore: number
  bm25Score: number
  vectorScore: number
  llmScore: number
  explanation: string
  job: {
    id: string
    title: string
    city: string | null
    salaryMin: number | null
    salaryMax: number | null
    remote: boolean
    hybrid: boolean
    employmentType: string
    seniority: string | null
  } | null
}

interface MatchScoreSectionProps {
  candidateId: string
  locale: string
}

export function MatchScoreSection({ candidateId, locale }: MatchScoreSectionProps) {
  const t = useTranslations('miscMatchScores')
  const [scores, setScores] = useState<MatchScore[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchScores = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(`/api/candidates/${candidateId}/match-scores`)

      if (!response.ok) {
        throw new Error('Failed to fetch match scores')
      }

      const data = await response.json()
      setScores(data.scores || [])
    } catch (err) {
      logger.error('Error fetching match scores', err)
      setError(err instanceof Error ? err.message : t('loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [candidateId])

  useEffect(() => {
    fetchScores()
  }, [fetchScores])

  const getMatchColor = (score: number) => {
    if (score >= 80) return 'text-green-600 dark:text-green-500'
    if (score >= 60) return 'text-blue-600 dark:text-blue-500'
    if (score >= 40) return 'text-yellow-600 dark:text-yellow-500'
    return 'text-gray-600 dark:text-gray-500'
  }

  const getMatchVariant = (score: number) => {
    if (score >= 80) return 'default'
    if (score >= 60) return 'secondary'
    return 'outline'
  }

  const getWorkModeLabel = (remote: boolean, hybrid: boolean) => {
    if (remote) return t('remote')
    if (hybrid) return t('hybrid')
    return t('onsite')
  }

  if (loading) {
    return (
      <div className="mb-6">
        <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold">
          <TrendingUp className="h-6 w-6" />
          {t('title')}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, idx) => (
            <Card key={idx}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="mt-2 h-4 w-1/2" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mb-6">
        <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold">
          <TrendingUp className="h-6 w-6" />
          {t('title')}
        </h2>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            {error}
            <Button variant="outline" size="sm" onClick={() => fetchScores()}>
              {t('retry')}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    )
  }

  if (scores.length === 0) {
    return (
      <div className="mb-6">
        <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold">
          <TrendingUp className="h-6 w-6" />
          {t('title')}
        </h2>
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            <Briefcase className="mx-auto mb-3 h-12 w-12 opacity-50" />
            <p>{t('noPositions')}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mb-6">
      <h2 className="mb-4 flex items-center gap-2 text-2xl font-bold">
        <TrendingUp className="h-6 w-6 text-primary" />
        {t('title')}
      </h2>

      <p className="mb-6 text-muted-foreground">{t('subtitle')}</p>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {scores.map((score) => {
          if (!score.job) return null

          return (
            <Card key={score.jobId} className="transition-shadow hover:shadow-lg">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <CardTitle className="line-clamp-2 text-lg">
                      <Link href={`/${locale}/jobs/${score.job.id}`} className="hover:text-primary">
                        {score.job.title}
                      </Link>
                    </CardTitle>
                    {score.job.city && (
                      <CardDescription className="mt-1 flex items-center gap-2 text-xs">
                        <MapPin className="h-3 w-3" />
                        {score.job.city}
                      </CardDescription>
                    )}
                  </div>
                  {score.job.seniority && (
                    <Badge variant="secondary" className="text-xs">
                      {score.job.seniority}
                    </Badge>
                  )}
                </div>

                {/* Overall Match Score */}
                <div className="mt-3">
                  <Badge
                    variant={getMatchVariant(score.matchScore)}
                    className="px-3 py-1 text-base"
                  >
                    <span className={getMatchColor(score.matchScore)}>
                      {t('matchPercent', { percent: Math.round(score.matchScore) })}
                    </span>
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Match Score Breakdown */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{t('bm25')}</span>
                    <span className="font-medium">{Math.round(score.bm25Score)}%</span>
                  </div>
                  <Progress value={score.bm25Score} className="h-1" />

                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{t('vector')}</span>
                    <span className="font-medium">{Math.round(score.vectorScore)}%</span>
                  </div>
                  <Progress value={score.vectorScore} className="h-1" />

                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{t('llm')}</span>
                    <span className="font-medium">{Math.round(score.llmScore)}%</span>
                  </div>
                  <Progress value={score.llmScore} className="h-1" />
                </div>

                {/* AI Explanation */}
                {score.explanation && (
                  <div className="border-l-2 border-primary pl-3 text-xs italic text-muted-foreground">
                    {score.explanation}
                  </div>
                )}

                {/* Job Details */}
                <div className="flex flex-wrap gap-1 text-xs">
                  <Badge variant="outline">
                    {getWorkModeLabel(score.job.remote, score.job.hybrid)}
                  </Badge>
                  <Badge variant="outline">{score.job.employmentType}</Badge>
                </div>

                {/* Salary */}
                {(score.job.salaryMin || score.job.salaryMax) && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Euro className="h-3 w-3" />
                    {score.job.salaryMin && score.job.salaryMax
                      ? `${score.job.salaryMin.toLocaleString()} - ${score.job.salaryMax.toLocaleString()}`
                      : score.job.salaryMin
                        ? `${score.job.salaryMin.toLocaleString()}+`
                        : t('salaryUpTo', {
                            amount: score.job.salaryMax?.toLocaleString() ?? '',
                          })}{' '}
                    {t('eurPerMonth')}
                  </div>
                )}

                {/* Action Button */}
                <Button variant="outline" size="sm" className="w-full" asChild>
                  <Link href={`/${locale}/jobs/${score.job.id}`}>{t('viewJob')}</Link>
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
