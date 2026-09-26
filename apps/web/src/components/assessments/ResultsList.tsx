'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScoreBadge } from './ScoreBadge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Search } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface Attempt {
  id: string
  submittedAt: Date | null
  totalScore: number | null
  percentage: number | null
  status: string
  candidate: {
    contacts: Array<{
      fullName: string | null
      email: string | null
    }>
  }
}

interface ResultsListProps {
  attempts: Attempt[]
  passingScore: number
}

export function ResultsList({ attempts, passingScore }: ResultsListProps) {
  const t = useTranslations('assessmentResults')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [passFilter, setPassFilter] = useState<string>('all')

  // Filter attempts
  const filteredAttempts = attempts.filter((attempt) => {
    // Search filter
    const primaryContact = attempt.candidate.contacts.find((c) => c.fullName || c.email)
    const candidateName = primaryContact?.fullName || primaryContact?.email || ''
    const matchesSearch = candidateName.toLowerCase().includes(searchTerm.toLowerCase())

    // Status filter
    const matchesStatus = statusFilter === 'all' || attempt.status === statusFilter

    // Pass/Fail filter
    let matchesPass = true
    if (passFilter === 'passed' && attempt.percentage !== null) {
      matchesPass = attempt.percentage >= passingScore
    } else if (passFilter === 'failed' && attempt.percentage !== null) {
      matchesPass = attempt.percentage < passingScore
    }

    return matchesSearch && matchesStatus && matchesPass
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:gap-4">
          <div className="relative flex-1">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              aria-label={t('searchAria')}
              placeholder={t('searchPlaceholder')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]" aria-label={t('filterStatusAria')}>
              <SelectValue placeholder={t('status')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allStatus')}</SelectItem>
              <SelectItem value="GRADED">{t('graded')}</SelectItem>
              <SelectItem value="SUBMITTED">{t('pending')}</SelectItem>
              <SelectItem value="IN_PROGRESS">{t('inProgress')}</SelectItem>
            </SelectContent>
          </Select>
          <Select value={passFilter} onValueChange={setPassFilter}>
            <SelectTrigger className="w-full sm:w-[180px]" aria-label={t('filterResultAria')}>
              <SelectValue placeholder={t('result')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allResults')}</SelectItem>
              <SelectItem value="passed">{t('passed')}</SelectItem>
              <SelectItem value="failed">{t('failed')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Results Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('candidate')}</TableHead>
              <TableHead>{t('submitted')}</TableHead>
              <TableHead>{t('score')}</TableHead>
              <TableHead>{t('status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAttempts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {t('noResults')}
                </TableCell>
              </TableRow>
            ) : (
              filteredAttempts.map((attempt) => {
                const primaryContact = attempt.candidate.contacts.find((c) => c.fullName || c.email)
                const candidateName =
                  primaryContact?.fullName || primaryContact?.email || t('unknown')
                const candidateEmail = primaryContact?.email

                return (
                  <TableRow key={attempt.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{candidateName}</p>
                        {candidateEmail && primaryContact?.fullName && (
                          <p className="text-sm text-muted-foreground">{candidateEmail}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>
                      {attempt.percentage !== null ? (
                        <ScoreBadge score={attempt.percentage} passingScore={passingScore} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          attempt.status === 'GRADED'
                            ? 'default'
                            : attempt.status === 'SUBMITTED'
                              ? 'secondary'
                              : 'outline'
                        }
                      >
                        {attempt.status === 'GRADED'
                          ? t('graded')
                          : attempt.status === 'SUBMITTED'
                            ? t('pending')
                            : t('inProgress')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>

        {/* Summary Stats */}
        <div className="mt-6 border-t pt-6">
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold">{attempts.length}</p>
              <p className="text-sm text-muted-foreground">{t('totalAttempts')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">
                {
                  attempts.filter((a) => a.percentage !== null && a.percentage >= passingScore)
                    .length
                }
              </p>
              <p className="text-sm text-muted-foreground">{t('passed')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">
                {
                  attempts.filter((a) => a.percentage !== null && a.percentage < passingScore)
                    .length
                }
              </p>
              <p className="text-sm text-muted-foreground">{t('failed')}</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-yellow-600">
                {attempts.filter((a) => a.status === 'SUBMITTED').length}
              </p>
              <p className="text-sm text-muted-foreground">{t('pendingReview')}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
