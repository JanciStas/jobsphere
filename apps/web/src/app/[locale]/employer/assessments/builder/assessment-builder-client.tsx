'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createAssessmentSchema, type CreateAssessmentInput } from '@/schemas/assessment.schema'
import {
  Plus,
  Trash2,
  Save,
  Loader2,
  GripVertical,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

export default function AssessmentBuilderClient() {
  const router = useRouter()
  const params = useParams()
  const locale = (params?.locale as string) || 'en'
  const t = useTranslations('employer')
  const tb = useTranslations('assessmentBuilder')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0]))
  // AI draft generation state.
  const [isGenerating, setIsGenerating] = useState(false)
  const [genJobTitle, setGenJobTitle] = useState('')
  const [genJobDescription, setGenJobDescription] = useState('')

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<CreateAssessmentInput>({
    resolver: zodResolver(createAssessmentSchema),
    defaultValues: {
      name: '',
      description: '',
      locale: 'en',
      durationMin: 60,
      passingScore: 70,
      randomize: false,
      sections: [
        {
          title: 'Section 1',
          description: '',
          order: 0,
          questions: [],
        },
      ],
    },
  })

  const {
    fields: sections,
    append: appendSection,
    remove: removeSection,
  } = useFieldArray({
    control,
    name: 'sections',
  })

  const toggleSection = (index: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const addSection = () => {
    const newIndex = sections.length
    appendSection({
      title: `Section ${newIndex + 1}`,
      description: '',
      order: newIndex,
      questions: [],
    })
    setExpandedSections((prev) => new Set(prev).add(newIndex))
  }

  // Validation used to fail silently: errors on a question inside a collapsed
  // section were never rendered, so the submit button just did nothing.
  const onInvalid = (formErrors: Record<string, unknown>) => {
    const sectionErrors = formErrors.sections
    if (Array.isArray(sectionErrors)) {
      const withErrors: number[] = []
      sectionErrors.forEach((entry, index) => {
        if (entry) withErrors.push(index)
      })
      if (withErrors.length > 0) {
        setExpandedSections((prev) => new Set([...prev, ...withErrors]))
      }
    }
    toast.error(tb('fixFields'))
  }

  const onSubmit = async (data: CreateAssessmentInput) => {
    try {
      setIsSubmitting(true)

      // Transform correctIndexes from string to array of numbers
      const transformedData = {
        ...data,
        sections: data.sections.map((section) => ({
          ...section,
          questions: section.questions.map((question) => {
            const transformed: any = { ...question }

            // Convert correctIndexes string to array of numbers
            if (typeof transformed.correctIndexes === 'string') {
              transformed.correctIndexes = transformed.correctIndexes
                .split(',')
                .map((s: string) => parseInt(s.trim()))
                .filter((n: number) => !isNaN(n))
            }

            return transformed
          }),
        })),
      }

      const response = await fetch('/api/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(transformedData),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || tb('createFailed'))
      }

      const result = await response.json()

      toast.success(tb('createdSuccess'), {
        description: tb('createdDescription', { count: result.assessment.sections.length }),
      })

      // Was `/employer/assessments/${result.assessment.id}` — wrong twice over:
      // that page does not exist (only `[id]/results` does), and the missing
      // locale prefix threw the user out of the `[locale]` segment. Saving an
      // assessment therefore ended on a 404 even though it had been created.
      router.push(`/${locale}/employer/assessments/${result.assessment.id}/results`)
    } catch (error) {
      const message = error instanceof Error ? error.message : tb('createFailed')
      toast.error(tb('error'), { description: message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const onGenerate = async () => {
    if (!genJobTitle.trim() || !genJobDescription.trim()) {
      toast.error(tb('addTitleDescFirst'))
      return
    }
    try {
      setIsGenerating(true)
      const response = await fetch('/api/assessments/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitle: genJobTitle,
          jobDescription: genJobDescription,
          locale: watch('locale'),
        }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || tb('generateFailed'))
      }
      const { assessment } = await response.json()
      // Load the AI draft into the form. Expand every generated section.
      reset({
        name: assessment.name ?? '',
        description: assessment.description ?? '',
        locale: assessment.locale ?? watch('locale'),
        durationMin: assessment.durationMin ?? 60,
        passingScore: assessment.passingScore ?? 70,
        randomize: assessment.randomize ?? false,
        sections: assessment.sections ?? [],
      })
      setExpandedSections(new Set((assessment.sections ?? []).map((_: unknown, i: number) => i)))
      toast.success(tb('draftGenerated'), {
        description: tb('draftGeneratedDescription', { count: assessment.sections?.length ?? 0 }),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : tb('generateFailed')
      toast.error(tb('error'), { description: message })
    } finally {
      setIsGenerating(false)
    }
  }

  const watchedSections = watch('sections')
  const totalQuestions = watchedSections?.reduce(
    (sum, section) => sum + (section.questions?.length || 0),
    0,
  )

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-12">
          <h1 className="mb-4 text-4xl font-bold">{tb('pageTitle')}</h1>
          <p className="text-xl text-muted-foreground">{tb('pageSubtitle')}</p>
        </div>

        {/* AI Generation Card — sits outside the form so its inputs don't submit it */}
        <Card className="mx-auto mb-6 max-w-5xl border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              {tb('generateHeading')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{tb('generateHelp')}</p>
            <div>
              <Label htmlFor="genJobTitle">{tb('jobTitle')}</Label>
              <Input
                id="genJobTitle"
                value={genJobTitle}
                onChange={(e) => setGenJobTitle(e.target.value)}
                placeholder={tb('jobTitlePlaceholder')}
              />
            </div>
            <div>
              <Label htmlFor="genJobDescription">{tb('jobDescription')}</Label>
              <textarea
                id="genJobDescription"
                value={genJobDescription}
                onChange={(e) => setGenJobDescription(e.target.value)}
                placeholder={tb('jobDescriptionPlaceholder')}
                className="min-h-[120px] w-full rounded-md border px-3 py-2"
                rows={4}
              />
            </div>
            <Button type="button" onClick={onGenerate} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tb('generating')}
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t('generateWithAi')}
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="mx-auto max-w-5xl space-y-6">
          {/* Basic Info Card */}
          <Card>
            <CardHeader>
              <CardTitle>{tb('basicInfo')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="name">{tb('assessmentName')}</Label>
                <Input
                  id="name"
                  {...register('name')}
                  placeholder={tb('assessmentNamePlaceholder')}
                />
                {errors.name && (
                  <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="description">{tb('descriptionOptional')}</Label>
                <textarea
                  id="description"
                  {...register('description')}
                  placeholder={tb('descriptionPlaceholder')}
                  className="min-h-[80px] w-full rounded-md border px-3 py-2"
                  rows={3}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Label htmlFor="durationMin">{tb('duration')}</Label>
                  <Input
                    id="durationMin"
                    type="number"
                    {...register('durationMin', { valueAsNumber: true })}
                    placeholder="60"
                  />
                  {errors.durationMin && (
                    <p className="mt-1 text-sm text-destructive">{errors.durationMin.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="passingScore">{tb('passingScore')}</Label>
                  <Input
                    id="passingScore"
                    type="number"
                    {...register('passingScore', { valueAsNumber: true })}
                    placeholder="70"
                  />
                  {errors.passingScore && (
                    <p className="mt-1 text-sm text-destructive">{errors.passingScore.message}</p>
                  )}
                </div>

                <div>
                  <Label htmlFor="locale">{tb('language')}</Label>
                  <select
                    id="locale"
                    {...register('locale')}
                    className="w-full rounded-md border px-3 py-2"
                  >
                    <option value="en">{tb('langEn')}</option>
                    <option value="de">{tb('langDe')}</option>
                    <option value="sk">{tb('langSk')}</option>
                    <option value="cs">{tb('langCs')}</option>
                    <option value="pl">{tb('langPl')}</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="randomize"
                  type="checkbox"
                  {...register('randomize')}
                  className="h-4 w-4"
                />
                <Label htmlFor="randomize" className="font-normal">
                  {tb('randomize')}
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Sections */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">
                {tb('sectionsHeading', {
                  sections: sections.length,
                  questions: totalQuestions ?? 0,
                })}
              </h2>
              <Button type="button" onClick={addSection} variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                {tb('addSection')}
              </Button>
            </div>

            {sections.map((section, sectionIndex) => (
              <SectionEditor
                key={section.id}
                sectionIndex={sectionIndex}
                control={control}
                register={register}
                errors={errors}
                removeSection={removeSection}
                isExpanded={expandedSections.has(sectionIndex)}
                toggleExpanded={() => toggleSection(sectionIndex)}
                watch={watch}
              />
            ))}

            {sections.length === 0 && (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  <p>{tb('noSections')}</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Submit Button */}
          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              {tb('cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || sections.length === 0}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {tb('creating')}
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  {tb('createButton')}
                </>
              )}
            </Button>
          </div>

          {errors.sections && (
            <p className="text-sm text-destructive">
              {typeof errors.sections.message === 'string' && errors.sections.message}
            </p>
          )}
        </form>
      </div>
    </div>
  )
}

function SectionEditor({
  sectionIndex,
  control,
  register,
  errors,
  removeSection,
  isExpanded,
  toggleExpanded,
  watch,
}: {
  sectionIndex: number
  control: any
  register: any
  errors: any
  removeSection: (index: number) => void
  isExpanded: boolean
  toggleExpanded: () => void
  watch: any
}) {
  const tb = useTranslations('assessmentBuilder')
  const {
    fields: questions,
    append: appendQuestion,
    remove: removeQuestion,
  } = useFieldArray({
    control,
    name: `sections.${sectionIndex}.questions`,
  })

  const addQuestion = (type: 'MCQ' | 'MULTI_SELECT' | 'SHORT_TEXT' | 'LONG_TEXT' | 'CODE') => {
    const baseQuestion = {
      type,
      text: '',
      points: 10,
      order: questions.length,
    }

    if (type === 'MCQ' || type === 'MULTI_SELECT') {
      appendQuestion({
        ...baseQuestion,
        choices: ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
        correctIndexes: [0],
      })
    } else if (type === 'CODE') {
      appendQuestion({
        ...baseQuestion,
        code: '// Write your solution here\nfunction solve() {\n  \n}',
        language: 'javascript',
      })
    } else {
      appendQuestion(baseQuestion)
    }
  }

  const sectionErrors = errors.sections?.[sectionIndex]

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          {/* A real button so the section can be toggled from the keyboard; the old
              clickable div had no role, tabindex or key handler. */}
          <button
            type="button"
            aria-expanded={isExpanded}
            onClick={toggleExpanded}
            className="flex flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <GripVertical className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span className="text-lg font-semibold leading-none tracking-tight">
              {tb('sectionHeader', { n: sectionIndex + 1, count: questions.length })}
            </span>
            {isExpanded ? (
              <ChevronUp className="ml-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronDown className="ml-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
            )}
          </button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={tb('deleteSection', { n: sectionIndex + 1 })}
            onClick={() => removeSection(sectionIndex)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          <div>
            <Label>{tb('sectionTitle')}</Label>
            <Input
              {...register(`sections.${sectionIndex}.title`)}
              placeholder={tb('sectionTitlePlaceholder')}
            />
            {sectionErrors?.title && (
              <p className="mt-1 text-sm text-destructive">{sectionErrors.title.message}</p>
            )}
          </div>

          <div>
            <Label>{tb('sectionDescription')}</Label>
            <textarea
              {...register(`sections.${sectionIndex}.description`)}
              placeholder={tb('sectionDescriptionPlaceholder')}
              className="min-h-[60px] w-full rounded-md border px-3 py-2"
              rows={2}
            />
          </div>

          {/* Add Question Buttons */}
          <div>
            <Label className="mb-2 block">{tb('addQuestion')}</Label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addQuestion('MCQ')}
                className="text-xs"
              >
                {tb('typeMcq')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addQuestion('MULTI_SELECT')}
                className="text-xs"
              >
                {tb('typeMultiSelect')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addQuestion('SHORT_TEXT')}
                className="text-xs"
              >
                {tb('typeShortText')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addQuestion('LONG_TEXT')}
                className="text-xs"
              >
                {tb('typeLongText')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addQuestion('CODE')}
                className="text-xs"
              >
                {tb('typeCode')}
              </Button>
            </div>
          </div>

          {/* Questions List */}
          <div className="space-y-3">
            {questions.map((question, questionIndex) => {
              const questionType = watch(`sections.${sectionIndex}.questions.${questionIndex}.type`)
              return (
                <QuestionEditor
                  key={question.id}
                  sectionIndex={sectionIndex}
                  questionIndex={questionIndex}
                  register={register}
                  control={control}
                  removeQuestion={removeQuestion}
                  errors={errors}
                  questionType={questionType}
                />
              )
            })}

            {questions.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">{tb('noQuestions')}</p>
            )}
          </div>

          {sectionErrors?.questions && (
            <p className="text-sm text-destructive">
              {typeof sectionErrors.questions.message === 'string' &&
                sectionErrors.questions.message}
            </p>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function QuestionEditor({
  sectionIndex,
  questionIndex,
  register,
  control,
  removeQuestion,
  errors,
  questionType,
}: {
  sectionIndex: number
  questionIndex: number
  register: any
  control: any
  removeQuestion: (index: number) => void
  errors: any
  questionType: 'MCQ' | 'MULTI_SELECT' | 'SHORT_TEXT' | 'LONG_TEXT' | 'CODE'
}) {
  const tb = useTranslations('assessmentBuilder')
  const questionPath = `sections.${sectionIndex}.questions.${questionIndex}`
  const questionErrors = errors.sections?.[sectionIndex]?.questions?.[questionIndex]

  const {
    fields: choices,
    append: appendChoice,
    remove: removeChoice,
  } = useFieldArray({
    control,
    name: `${questionPath}.choices`,
  })

  return (
    <div className="rounded-lg border border-muted bg-muted/30 p-4">
      <div className="mb-3 flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-2">
            <Label htmlFor={`${questionPath}-text`}>
              {tb('question', { n: questionIndex + 1 })}
            </Label>
            <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {(questionType ?? '').replace('_', ' ')}
            </span>
          </div>
          <textarea
            id={`${questionPath}-text`}
            {...register(`${questionPath}.text`)}
            placeholder={tb('questionPlaceholder')}
            className="mt-1 min-h-[80px] w-full rounded-md border bg-background px-3 py-2"
            rows={2}
          />
          {questionErrors?.text && (
            <p className="mt-1 text-sm text-destructive">{questionErrors.text.message}</p>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={tb('deleteQuestion', { n: questionIndex + 1 })}
          onClick={() => removeQuestion(questionIndex)}
          className="ml-2"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${questionPath}-points`} className="text-xs">
            {tb('points')}
          </Label>
          <Input
            id={`${questionPath}-points`}
            type="number"
            {...register(`${questionPath}.points`, { valueAsNumber: true })}
            className="h-8"
          />
        </div>
        <div>
          <Label htmlFor={`${questionPath}-skillTag`} className="text-xs">
            {tb('skillTag')}
          </Label>
          <Input
            id={`${questionPath}-skillTag`}
            {...register(`${questionPath}.skillTag`)}
            placeholder={tb('skillTagPlaceholder')}
            className="h-8"
          />
        </div>
      </div>

      {/* Type-specific fields */}
      {(questionType === 'MCQ' || questionType === 'MULTI_SELECT') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">{tb('choices')}</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => appendChoice(`Option ${choices.length + 1}`)}
              className="h-6 text-xs"
            >
              <Plus className="mr-1 h-3 w-3" />
              {tb('addChoice')}
            </Button>
          </div>
          {choices.map((choice, choiceIndex) => (
            <div key={choice.id} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{choiceIndex + 1}.</span>
              <Input
                {...register(`${questionPath}.choices.${choiceIndex}`)}
                className="h-8 flex-1 text-sm"
                placeholder={tb('choicePlaceholder', { n: choiceIndex + 1 })}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={tb('deleteChoice', { n: choiceIndex + 1 })}
                onClick={() => removeChoice(choiceIndex)}
                className="h-6 px-2"
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
          <div className="mt-2">
            <Label htmlFor={`${questionPath}-correctIndexes`} className="text-xs">
              {questionType === 'MULTI_SELECT' ? tb('correctAnswers') : tb('correctAnswer')}
            </Label>
            <Input
              id={`${questionPath}-correctIndexes`}
              {...register(`${questionPath}.correctIndexes`)}
              className="h-8 text-sm"
              placeholder="0"
              aria-invalid={questionErrors?.correctIndexes ? true : undefined}
            />
            {questionErrors?.correctIndexes && (
              <p className="mt-1 text-sm text-destructive">
                {questionErrors.correctIndexes.message ?? tb('correctInvalid')}
              </p>
            )}
          </div>
        </div>
      )}

      {questionType === 'CODE' && (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">{tb('programmingLanguage')}</Label>
            <select
              {...register(`${questionPath}.language`)}
              className="h-8 w-full rounded-md border px-2 text-sm"
            >
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="java">Java</option>
              <option value="cpp">C++</option>
              <option value="csharp">C#</option>
              <option value="go">Go</option>
              <option value="rust">Rust</option>
            </select>
          </div>
          <div>
            <Label className="text-xs">{tb('starterCode')}</Label>
            <textarea
              {...register(`${questionPath}.code`)}
              className="min-h-[100px] w-full rounded-md border bg-background px-3 py-2 font-mono text-sm"
              placeholder="// Write your solution here&#10;function solve() {&#10;  &#10;}"
              rows={5}
            />
          </div>
        </div>
      )}
    </div>
  )
}
