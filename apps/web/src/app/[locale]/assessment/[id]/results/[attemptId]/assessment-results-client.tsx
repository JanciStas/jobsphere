'use client'

/**
 * Assessment Results Page
 * Zobrazuje výsledky po dokončení testu
 */

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { logger } from '@/lib/logger'

interface Question {
  id: string
  type: string
  title: string
  points: number
}

interface Answer {
  id: string
  questionId: string
  answer: any
  score: number | null
  feedback: string | null
}

interface Attempt {
  id: string
  score: number | null
  maxScore: number
  scorePercent: number | null
  isPassed: boolean | null
  submittedAt: string
  gradedAt: string | null
  assessment: {
    title: string
    passingScore: number
    questions: Question[]
  }
  answers: Answer[]
}

export default function AssessmentResultsClient({
  params,
}: {
  params: { id: string; attemptId: string }
}) {
  const t = useTranslations('assessmentResults')
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadResults()

    // Poll for grading completion
    const interval = setInterval(() => {
      if (!attempt?.gradedAt) {
        loadResults()
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [params.attemptId])

  async function loadResults() {
    try {
      const response = await fetch(`/api/assessments/${params.id}/results/${params.attemptId}`)

      if (response.ok) {
        const data = await response.json()
        setAttempt(data.attempt)
      }
    } catch (error) {
      logger.error('Failed to load results', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!attempt) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-600">{t('notFound')}</p>
      </div>
    )
  }

  const isGraded = attempt.gradedAt !== null

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-6 rounded-lg bg-white p-8 text-center shadow-sm">
          <h1 className="mb-2 text-3xl font-bold text-gray-900">{attempt.assessment.title}</h1>
          <p className="text-gray-600">{t('title')}</p>

          {!isGraded ? (
            <div className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-6">
              <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-blue-600" />
              <p className="text-lg font-medium text-blue-900">{t('grading')}</p>
              <p className="mt-1 text-sm text-blue-700">{t('gradingHelp')}</p>
            </div>
          ) : (
            <>
              {/* Score Circle */}
              <div className="mb-6 mt-8">
                <div
                  className={`mx-auto flex h-40 w-40 items-center justify-center rounded-full border-8 ${
                    attempt.isPassed ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'
                  }`}
                >
                  <div className="text-center">
                    <p className="text-5xl font-bold text-gray-900">{attempt.scorePercent}%</p>
                    <p className="mt-1 text-sm text-gray-600">
                      {t('scorePoints', { score: attempt.score ?? 0, max: attempt.maxScore })}
                    </p>
                  </div>
                </div>
              </div>

              {/* Pass/Fail Status */}
              {attempt.isPassed ? (
                <div className="flex items-center justify-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                  <div className="text-left">
                    <p className="font-semibold text-green-900">{t('congratulations')}</p>
                    <p className="text-sm text-green-700">
                      {t('passedMessage', { required: attempt.assessment.passingScore })}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
                  <XCircle className="h-6 w-6 text-red-600" />
                  <div className="text-left">
                    <p className="font-semibold text-red-900">{t('notPassed')}</p>
                    <p className="text-sm text-red-700">
                      {t('requiredScore', { required: attempt.assessment.passingScore })}
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Questions & Answers */}
        {isGraded && (
          <div className="space-y-4">
            {attempt.assessment.questions.map((question, idx) => {
              const answer = attempt.answers.find((a) => a.questionId === question.id)

              if (!answer) return null

              const scorePercent =
                question.points > 0 ? ((answer.score || 0) / question.points) * 100 : 0

              return (
                <div
                  key={question.id}
                  className="rounded-lg border-l-4 bg-white p-6 shadow-sm"
                  style={{
                    borderLeftColor:
                      scorePercent >= 70 ? '#10b981' : scorePercent >= 40 ? '#f59e0b' : '#ef4444',
                  }}
                >
                  <div className="mb-4 flex items-start justify-between">
                    <div className="flex-1">
                      <h3 className="text-lg font-semibold text-gray-900">
                        {t('questionTitle', { n: idx + 1, title: question.title })}
                      </h3>
                      <p className="mt-1 text-sm text-gray-600">
                        {t('type', { type: question.type.replace('_', ' ') })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-gray-900">
                        {answer.score}/{question.points}
                      </p>
                      <p className="text-sm text-gray-600">{t('pointsLabel')}</p>
                    </div>
                  </div>

                  {/* Your Answer */}
                  <div className="mb-4">
                    <p className="mb-2 text-sm font-medium text-gray-700">{t('yourAnswer')}</p>
                    <div className="rounded-lg bg-gray-50 p-4">
                      {question.type === 'MULTIPLE_CHOICE' ? (
                        <p className="text-gray-900">{t('option', { n: answer.answer + 1 })}</p>
                      ) : question.type === 'CODE' ? (
                        <pre className="overflow-x-auto font-mono text-sm text-gray-900">
                          {answer.answer}
                        </pre>
                      ) : (
                        <p className="whitespace-pre-wrap text-gray-900">{answer.answer}</p>
                      )}
                    </div>
                  </div>

                  {/* Feedback */}
                  {answer.feedback && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                      <p className="mb-1 text-sm font-medium text-blue-900">{t('feedback')}</p>
                      <p className="text-sm text-blue-800">{answer.feedback}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Metadata */}
        {isGraded && (
          <div className="mt-6 rounded-lg bg-white p-6 shadow-sm">
            <h3 className="mb-4 font-semibold text-gray-900">{t('details')}</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-600">{t('submitted')}</p>
                <p className="font-medium text-gray-900">
                  {new Date(attempt.submittedAt).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-gray-600">{t('graded')}</p>
                <p className="font-medium text-gray-900">
                  {new Date(attempt.gradedAt!).toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
