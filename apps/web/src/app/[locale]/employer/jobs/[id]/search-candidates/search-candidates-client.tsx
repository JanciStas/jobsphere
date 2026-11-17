'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Search, Loader2, ArrowLeft, Mail, MapPin, Calendar, Star } from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'

interface CandidateMatch {
  candidateId: string
  resumeId: string
  resumeTitle: string
  similarity: number
  matchedSection?: {
    type: string
    content: string
  }
  contact?: {
    fullName: string
    email: string
    location: string | null
    availableFrom: Date | null
  }
}

interface SearchResult {
  success: boolean
  jobId: string
  jobTitle: string
  totalMatches: number
  matches: CandidateMatch[]
}

export default function SearchCandidatesClient({
  params,
}: {
  params: { locale: string; id: string }
}) {
  const t = useTranslations('employer.searchCandidates')
  const tp = useTranslations('employerPages')
  const [isSearching, setIsSearching] = useState(false)
  const [isLoadingJob, setIsLoadingJob] = useState(true)
  const [jobTitle, setJobTitle] = useState('')
  const [results, setResults] = useState<SearchResult | null>(null)

  // Search parameters
  const [limit, setLimit] = useState(10)
  const [minSimilarity, setMinSimilarity] = useState(0.5)

  // Published assessments, for the "Send assessment" action. Loaded once; an
  // empty list is why that button renders disabled rather than absent.
  const [assessments, setAssessments] = useState<{ id: string; name: string }[]>([])
  const [invitingCandidateId, setInvitingCandidateId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/assessments')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.assessments) {
          setAssessments(
            data.assessments.map((a: { id: string; name: string }) => ({ id: a.id, name: a.name })),
          )
        }
      })
      .catch(() => {
        // Non-fatal: the search results are still useful without this action.
      })
  }, [])

  const sendAssessment = async (candidateId: string, assessmentId: string) => {
    setInvitingCandidateId(candidateId)
    try {
      const response = await fetch(`/api/assessments/${assessmentId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateId, jobId: params.id }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to send assessment')
      }
      toast.success('Assessment sent')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send assessment')
    } finally {
      setInvitingCandidateId(null)
    }
  }

  // Load job title on mount
  useEffect(() => {
    const loadJob = async () => {
      try {
        const response = await fetch(`/api/jobs/${params.id}`)
        if (!response.ok) throw new Error('Job not found')

        const job = await response.json()
        setJobTitle(job.title)
      } catch (error) {
        toast.error('Error', {
          description: error instanceof Error ? error.message : 'Failed to load job',
        })
      } finally {
        setIsLoadingJob(false)
      }
    }

    loadJob()
  }, [params.id])

  const handleSearch = async (overrideLimit?: number) => {
    try {
      setIsSearching(true)

      const effectiveLimit = overrideLimit ?? limit

      const response = await fetch('/api/candidates/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: params.id,
          limit: effectiveLimit,
          minSimilarity,
          includeDetails: true,
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Search failed')
      }

      const data = await response.json()
      setResults(data)

      toast.success('Search complete!', {
        description: `Found ${data.totalMatches} matching candidates`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to search candidates'
      toast.error('Error', { description: message })
    } finally {
      setIsSearching(false)
    }
  }

  if (isLoadingJob) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <Link href={`/${params.locale}/employer/jobs`}>
            <Button variant="ghost" size="sm" className="mb-4">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {tp('searchCandidatesBackToJobs')}
            </Button>
          </Link>
          <h1 className="mb-2 text-4xl font-bold">{tp('searchCandidatesTitle')}</h1>
          <p className="text-xl text-muted-foreground">
            {tp('searchCandidatesFor')} <span className="font-semibold">{jobTitle}</span>
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-4">
          {/* Search Filters Sidebar */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg">Search Filters</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>{t('quickPick')}</Label>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  {[5, 15, 30].map((n) => (
                    <Button
                      key={n}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isSearching}
                      onClick={() => {
                        setLimit(n)
                        handleSearch(n)
                      }}
                    >
                      Top {n}
                    </Button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{t('quickPickHint')}</p>
              </div>
              <div>
                <Label htmlFor="limit">Max Results</Label>
                <Input
                  id="limit"
                  type="number"
                  min={1}
                  max={100}
                  value={limit}
                  onChange={(e) => setLimit(parseInt(e.target.value))}
                />
              </div>

              <div>
                <Label htmlFor="minSimilarity">
                  Minimum Match Score ({Math.round(minSimilarity * 100)}%)
                </Label>
                <input
                  id="minSimilarity"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={minSimilarity}
                  onChange={(e) => setMinSimilarity(parseFloat(e.target.value))}
                  className="w-full"
                />
                <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
              </div>

              <Button onClick={() => handleSearch()} disabled={isSearching} className="w-full">
                {isSearching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Search
                  </>
                )}
              </Button>

              {results && (
                <div className="mt-4 rounded-lg bg-muted p-3 text-sm">
                  <p className="font-medium">Results:</p>
                  <p className="text-muted-foreground">{results.totalMatches} candidates found</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Results */}
          <div className="space-y-4 lg:col-span-3">
            {!results && !isSearching && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <Search className="mx-auto mb-4 h-12 w-12 opacity-50" />
                  <p>Configure your search filters and click Search to find matching candidates.</p>
                </CardContent>
              </Card>
            )}

            {results && results.matches.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <p>No candidates found matching your criteria.</p>
                  <p className="mt-2 text-sm">Try lowering the minimum match score.</p>
                </CardContent>
              </Card>
            )}

            {results &&
              results.matches.map((match) => (
                <Card key={match.candidateId} className="transition-shadow hover:shadow-md">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-xl">
                          {match.contact?.fullName || 'Anonymous Candidate'}
                        </CardTitle>
                        <p className="mt-1 text-sm text-muted-foreground">{match.resumeTitle}</p>
                      </div>
                      <div className="ml-4 flex flex-col items-end gap-2">
                        <Badge variant="default" className="text-lg font-semibold">
                          <Star className="mr-1 h-4 w-4" />
                          {Math.round(match.similarity * 100)}% Match
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {match.matchedSection?.type.replace('_', ' ')}
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {match.matchedSection && (
                      <div className="rounded-lg bg-muted p-3">
                        <p className="text-sm font-medium text-muted-foreground">
                          Matched Section:
                        </p>
                        <p className="mt-1 text-sm">{match.matchedSection.content}</p>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                      {match.contact?.email && (
                        <div className="flex items-center gap-1">
                          <Mail className="h-4 w-4" />
                          <span>{match.contact.email}</span>
                        </div>
                      )}
                      {match.contact?.location && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-4 w-4" />
                          <span>{match.contact.location}</span>
                        </div>
                      )}
                      {match.contact?.availableFrom && (
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          <span>
                            Available from{' '}
                            {new Date(match.contact.availableFrom).toLocaleDateString()}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* All three of these used to be decoration — rendered, styled,
                        and with no onClick. A button that does nothing is worse
                        than a missing one: it reads as a broken product. */}
                    <div className="flex flex-wrap gap-2">
                      <Button variant="default" size="sm" asChild>
                        <Link href={`/${params.locale}/candidates/${match.candidateId}`}>
                          View Profile
                        </Link>
                      </Button>
                      {match.contact?.email && (
                        <Button variant="outline" size="sm" asChild>
                          {/* These candidates have not applied, so there is no
                              application thread to send from — mailto is the honest
                              wiring rather than a dialog that cannot deliver. */}
                          <a
                            href={`mailto:${match.contact.email}?subject=${encodeURIComponent(jobTitle)}`}
                          >
                            <Mail className="mr-1 h-4 w-4" />
                            Contact
                          </a>
                        </Button>
                      )}
                      {assessments.length > 0 && (
                        <select
                          className="h-8 rounded-md border bg-background px-2 text-sm"
                          value=""
                          disabled={invitingCandidateId === match.candidateId}
                          onChange={(e) => {
                            if (e.target.value) sendAssessment(match.candidateId, e.target.value)
                          }}
                          aria-label={`Send an assessment to ${match.contact?.fullName || 'this candidate'}`}
                        >
                          <option value="">
                            {invitingCandidateId === match.candidateId
                              ? 'Sending…'
                              : 'Send assessment…'}
                          </option>
                          {assessments.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}
