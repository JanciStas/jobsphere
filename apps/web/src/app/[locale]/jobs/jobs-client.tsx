'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { useSession } from 'next-auth/react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  MapPin,
  Briefcase,
  Clock,
  Euro,
  Search,
  Filter,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatDistanceToNow } from 'date-fns'
import { sk, cs, pl, de, enUS } from 'date-fns/locale'
import { RecommendedJobsSection } from '@/components/jobs/RecommendedJobsSection'
import { logger } from '@/lib/logger'
import { stripMarkdown } from '@/lib/utils'
import { formatMoney } from '@/lib/formats'

// Job type from database
interface Job {
  id: string
  title: string
  location: string | null
  description?: string | null
  salaryMin?: number | null
  salaryMax?: number | null
  salaryCurrency?: string | null
  workMode: string
  type: string
  seniority?: string | null
  status: string
  createdAt: string
  publishedAt?: string | null
  organization: {
    name: string
    logo?: string | null
  }
}

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

// Get date locale based on current locale
function getDateLocale(locale: string) {
  switch (locale) {
    case 'sk':
      return sk
    case 'cs':
      return cs
    case 'pl':
      return pl
    case 'de':
      return de
    default:
      return enUS
  }
}

const WORK_MODES = ['REMOTE', 'HYBRID', 'ONSITE']
const JOB_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'FREELANCE', 'INTERNSHIP']
const SENIORITY_LEVELS = ['JUNIOR', 'MID', 'SENIOR', 'LEAD', 'EXECUTIVE']

interface Props {
  params: { locale: string }
  initialJobs: Job[]
  initialTotal: number
  initialPage: number
  totalPages: number
  pageSize: number
  initialFilters?: {
    search?: string
    location?: string
    workMode?: string
    jobType?: string
    seniority?: string
  }
}

export default function JobsClient({
  params,
  initialJobs,
  initialTotal,
  initialPage,
  totalPages: initialTotalPages,
  pageSize,
  initialFilters = {},
}: Props) {
  const t = useTranslations()
  const format = useFormatter()
  // Each posting renders in its own currency — a PLN job must not show euros.
  const money = (amount: number, currency?: string | null) =>
    formatMoney(format.number, amount, currency)
  const { data: session } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const locale = params.locale
  const dateLocale = getDateLocale(locale)
  const [isPending, startTransition] = useTransition()

  // State — initialised from SSR data
  const [jobs, setJobs] = useState<Job[]>(initialJobs)
  const [total, setTotal] = useState(initialTotal)
  const [totalPages, setTotalPages] = useState(initialTotalPages)
  const [currentPage, setCurrentPage] = useState(initialPage)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState(initialFilters.search ?? '')
  const [locationQuery, setLocationQuery] = useState(initialFilters.location ?? '')
  const [selectedWorkModes, setSelectedWorkModes] = useState<string[]>(
    initialFilters.workMode ? [initialFilters.workMode] : [],
  )
  const [selectedJobTypes, setSelectedJobTypes] = useState<string[]>(
    initialFilters.jobType ? [initialFilters.jobType] : [],
  )
  const [selectedSeniority, setSelectedSeniority] = useState<string[]>(
    initialFilters.seniority ? [initialFilters.seniority] : [],
  )

  const debouncedSearch = useDebounce(searchQuery, 500)
  const debouncedLocation = useDebounce(locationQuery, 500)

  // Build URL search params for navigation & API calls
  function buildParams(page: number, overrides?: Record<string, string | undefined>) {
    const p = new URLSearchParams()
    const s = overrides?.search ?? debouncedSearch
    const loc = overrides?.location ?? debouncedLocation
    const wm =
      overrides?.workMode ?? (selectedWorkModes.length === 1 ? selectedWorkModes[0] : undefined)
    const jt =
      overrides?.jobType ?? (selectedJobTypes.length === 1 ? selectedJobTypes[0] : undefined)
    const sen =
      overrides?.seniority ?? (selectedSeniority.length === 1 ? selectedSeniority[0] : undefined)
    if (s) p.set('search', s)
    if (loc) p.set('location', loc)
    if (wm) p.set('workMode', wm)
    if (jt) p.set('jobType', jt)
    if (sen) p.set('seniority', sen)
    if (page > 1) p.set('page', String(page))
    return p
  }

  // Fetch jobs from API (client-side after filter/page change)
  const fetchJobs = useCallback(
    async (page: number, signal?: AbortSignal) => {
      setLoading(true)
      setError(null)

      try {
        const p = new URLSearchParams()
        if (debouncedSearch) p.set('search', debouncedSearch)
        if (debouncedLocation) p.set('location', debouncedLocation)
        if (selectedWorkModes.length === 1) p.set('workMode', selectedWorkModes[0])
        if (selectedJobTypes.length === 1) p.set('jobType', selectedJobTypes[0])
        if (selectedSeniority.length === 1) p.set('seniority', selectedSeniority[0])
        p.set('page', String(page))
        p.set('limit', String(pageSize))

        const response = await fetch(`/api/jobs?${p.toString()}`, { signal })

        if (!response.ok) {
          throw new Error(`Failed to fetch jobs: ${response.statusText}`)
        }

        const data = await response.json()
        let jobsArray: Job[] = Array.isArray(data) ? data : (data.data ?? [])
        const serverTotal: number = data.total ?? jobsArray.length

        // Client-side multi-filter when multiple values selected
        if (selectedWorkModes.length > 1) {
          jobsArray = jobsArray.filter((job) => selectedWorkModes.includes(job.workMode))
        }
        if (selectedJobTypes.length > 1) {
          jobsArray = jobsArray.filter((job) => selectedJobTypes.includes(job.type))
        }
        if (selectedSeniority.length > 1) {
          jobsArray = jobsArray.filter(
            (job) => job.seniority && selectedSeniority.includes(job.seniority),
          )
        }

        setJobs(jobsArray)
        setTotal(serverTotal)
        setTotalPages(Math.ceil(serverTotal / pageSize))
        setCurrentPage(page)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        logger.error('Error fetching jobs', err)
        setError(err instanceof Error ? err.message : 'Failed to load jobs')
      } finally {
        setLoading(false)
      }
    },
    [
      debouncedSearch,
      debouncedLocation,
      selectedWorkModes,
      selectedJobTypes,
      selectedSeniority,
      pageSize,
    ],
  )

  // Re-fetch when filters change (reset to page 1)
  useEffect(() => {
    // Skip on initial mount — we already have SSR data
    const ctrl = new AbortController()
    fetchJobs(1, ctrl.signal)
    // Update URL so the page is shareable / history works
    startTransition(() => {
      const p = buildParams(1)
      router.replace(`${pathname}${p.toString() ? `?${p.toString()}` : ''}`, { scroll: false })
    })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, debouncedLocation, selectedWorkModes, selectedJobTypes, selectedSeniority])

  const goToPage = (page: number) => {
    const ctrl = new AbortController()
    fetchJobs(page, ctrl.signal)
    startTransition(() => {
      const p = buildParams(page)
      router.push(`${pathname}${p.toString() ? `?${p.toString()}` : ''}`, { scroll: true })
    })
  }

  const toggleFilter = (value: string, selected: string[], setter: (values: string[]) => void) => {
    if (selected.includes(value)) {
      setter(selected.filter((item) => item !== value))
    } else {
      setter([...selected, value])
    }
  }

  const getWorkModeLabel = (mode: string) => {
    switch (mode) {
      case 'REMOTE':
        return t('jobs.remote')
      case 'HYBRID':
        return t('jobs.hybrid')
      case 'ONSITE':
        return t('jobs.onsite')
      default:
        return mode
    }
  }

  const getJobTypeLabel = (type: string) => {
    switch (type) {
      case 'FULL_TIME':
        return t('jobs.fullTime')
      case 'PART_TIME':
        return t('jobs.partTime')
      case 'CONTRACT':
        return t('jobs.contract')
      case 'FREELANCE':
        return 'Freelance'
      case 'INTERNSHIP':
        return 'Stáž'
      default:
        return type
    }
  }

  const getSeniorityLabel = (level: string) => {
    switch (level) {
      case 'JUNIOR':
        return 'Junior'
      case 'MID':
        return 'Medior'
      case 'SENIOR':
        return 'Senior'
      case 'LEAD':
        return 'Lead'
      case 'EXECUTIVE':
        return 'Executive'
      default:
        return level
    }
  }

  // Build crawlable href for a page number
  function pageHref(page: number) {
    const p = buildParams(page)
    return `${pathname}${p.toString() ? `?${p.toString()}` : ''}`
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-8">
          <h1 className="mb-2 text-4xl font-bold">{t('jobs.title')}</h1>
          <p className="text-muted-foreground">
            {loading || isPending ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('jobs.loading')}
              </span>
            ) : (
              <>
                {total} {total === 1 ? t('jobs.offer') : t('jobs.offers')} {t('jobs.found')}
              </>
            )}
          </p>
        </div>

        {/* Recommended Jobs Section - only for authenticated users */}
        {session && <RecommendedJobsSection locale={locale} />}

        {/* Search and Filters */}
        <div className="mb-8 flex flex-col gap-4 md:flex-row">
          {/* 1. Pracovná pozícia */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('jobs.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* 2. Lokalita */}
          <div className="relative flex-1">
            <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Lokalita (mesto alebo región)"
              value={locationQuery}
              onChange={(e) => setLocationQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="flex gap-2">
            {/* Work Mode Filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Filter className="h-4 w-4" />
                  {t('jobs.workMode')}
                  {selectedWorkModes.length > 0 && (
                    <Badge variant="secondary" className="ml-1 rounded-full">
                      {selectedWorkModes.length}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>{t('jobs.workMode')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {WORK_MODES.map((mode) => (
                  <DropdownMenuCheckboxItem
                    key={mode}
                    checked={selectedWorkModes.includes(mode)}
                    onCheckedChange={() =>
                      toggleFilter(mode, selectedWorkModes, setSelectedWorkModes)
                    }
                  >
                    {getWorkModeLabel(mode)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Job Type Filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Briefcase className="h-4 w-4" />
                  {t('jobs.jobType')}
                  {selectedJobTypes.length > 0 && (
                    <Badge variant="secondary" className="ml-1 rounded-full">
                      {selectedJobTypes.length}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>{t('jobs.jobType')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {JOB_TYPES.map((type) => (
                  <DropdownMenuCheckboxItem
                    key={type}
                    checked={selectedJobTypes.includes(type)}
                    onCheckedChange={() =>
                      toggleFilter(type, selectedJobTypes, setSelectedJobTypes)
                    }
                  >
                    {getJobTypeLabel(type)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Seniority Filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Clock className="h-4 w-4" />
                  {t('jobs.seniority')}
                  {selectedSeniority.length > 0 && (
                    <Badge variant="secondary" className="ml-1 rounded-full">
                      {selectedSeniority.length}
                    </Badge>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>{t('jobs.seniorityLevel')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {SENIORITY_LEVELS.map((level) => (
                  <DropdownMenuCheckboxItem
                    key={level}
                    checked={selectedSeniority.includes(level)}
                    onCheckedChange={() =>
                      toggleFilter(level, selectedSeniority, setSelectedSeniority)
                    }
                  >
                    {getSeniorityLabel(level)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Jobs Grid */}
        {error ? (
          <div className="py-12 text-center">
            <p className="mb-4 text-lg text-destructive">{error}</p>
            <Button variant="outline" onClick={() => fetchJobs(currentPage)}>
              {t('jobs.retry')}
            </Button>
          </div>
        ) : loading ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, index) => (
              <Card key={index} className="flex flex-col">
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="mt-2 h-4 w-1/2" />
                </CardHeader>
                <CardContent className="flex-1 space-y-3">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                  <Skeleton className="h-8 w-full" />
                </CardContent>
                <CardFooter>
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="ml-auto h-9 w-24" />
                </CardFooter>
              </Card>
            ))}
          </div>
        ) : (
          // Test hook: the "Recommended for you" carousel above renders job
          // cards too and is deliberately unfiltered, so there is no other way
          // to address the filtered result set.
          <div data-testid="job-results" className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => (
              <Card key={job.id} className="flex flex-col transition-shadow hover:shadow-lg">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <CardTitle className="line-clamp-2">{job.title}</CardTitle>
                      <CardDescription className="mt-1">{job.organization.name}</CardDescription>
                    </div>
                    {job.seniority && (
                      <Badge variant="secondary">{getSeniorityLabel(job.seniority)}</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-4 w-4" />
                    {job.location ?? (job.workMode === 'REMOTE' ? t('jobs.remote') : '')}
                  </div>
                  {(job.salaryMin || job.salaryMax) && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Euro className="h-4 w-4" />
                      {job.salaryMin && job.salaryMax
                        ? `${money(job.salaryMin, job.salaryCurrency)} - ${money(job.salaryMax, job.salaryCurrency)}`
                        : job.salaryMin
                          ? `${money(job.salaryMin, job.salaryCurrency)}+`
                          : `${t('jobs.upTo')} ${money(job.salaryMax ?? 0, job.salaryCurrency)}`}{' '}
                      / {t('jobs.perMonth')}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{getWorkModeLabel(job.workMode)}</Badge>
                    <Badge variant="outline">{getJobTypeLabel(job.type)}</Badge>
                  </div>
                  {job.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {stripMarkdown(job.description)}
                    </p>
                  )}
                </CardContent>
                <CardFooter className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(job.publishedAt ?? job.createdAt), {
                      addSuffix: true,
                      locale: dateLocale,
                    })}
                  </span>
                  <Button asChild size="sm">
                    <Link href={`/${locale}/jobs/${job.id}`}>{t('jobs.viewDetail')}</Link>
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}

        {!loading && !error && jobs.length === 0 && (
          <div className="py-12 text-center">
            <p className="text-lg text-muted-foreground">{t('jobs.noResults')}</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setSearchQuery('')
                setLocationQuery('')
                setSelectedWorkModes([])
                setSelectedJobTypes([])
                setSelectedSeniority([])
              }}
            >
              {t('jobs.resetFilters')}
            </Button>
          </div>
        )}

        {/* Crawlable pagination — real <a> links for search engines */}
        {totalPages > 1 && (
          <nav
            aria-label="Job listings pagination"
            className="mt-10 flex items-center justify-center gap-2"
          >
            {currentPage > 1 && (
              <a
                href={pageHref(currentPage - 1)}
                rel="prev"
                onClick={(e) => {
                  e.preventDefault()
                  goToPage(currentPage - 1)
                }}
                className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </a>
            )}

            {/* Page number links */}
            {Array.from({ length: Math.min(totalPages, 7) }, (_) => {
              // Show first, last, current ±2, and ellipsis
              const first = 1
              const last = totalPages
              const near = [
                currentPage - 2,
                currentPage - 1,
                currentPage,
                currentPage + 1,
                currentPage + 2,
              ]
              const pages = [...new Set([first, ...near, last])].filter(
                (p) => p >= 1 && p <= totalPages,
              )
              return pages
            })[0]
              .reduce<(number | 'ellipsis')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('ellipsis')
                acc.push(p)
                return acc
              }, [])
              .map((item, idx) =>
                item === 'ellipsis' ? (
                  <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">
                    …
                  </span>
                ) : (
                  <a
                    key={item}
                    href={pageHref(item)}
                    onClick={(e) => {
                      e.preventDefault()
                      goToPage(item)
                    }}
                    aria-current={item === currentPage ? 'page' : undefined}
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-md border text-sm font-medium hover:bg-muted ${
                      item === currentPage
                        ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                        : ''
                    }`}
                  >
                    {item}
                  </a>
                ),
              )}

            {currentPage < totalPages && (
              <a
                href={pageHref(currentPage + 1)}
                rel="next"
                onClick={(e) => {
                  e.preventDefault()
                  goToPage(currentPage + 1)
                }}
                className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                aria-label="Next page"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </a>
            )}
          </nav>
        )}
      </div>
    </div>
  )
}
