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
        throw new Error(error.error || 'Failed to create assessment')
      }

      const result = await response.json()

      toast.success('Assessment created successfully!', {
        description: `Created assessment with ${result.assessment.sections.length} sections`,
      })

      // Was `/employer/assessments/${result.assessment.id}` — wrong twice over:
      // that page does not exist (only `[id]/results` does), and the missing
      // locale prefix threw the user out of the `[locale]` segment. Saving an
      // assessment therefore ended on a 404 even though it had been created.
      router.push(`/${locale}/employer/assessments/${result.assessment.id}/results`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create assessment'
      toast.error('Error', { description: message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const onGenerate = async () => {
    if (!genJobTitle.trim() || !genJobDescription.trim()) {
      toast.error('Add a job title and description first')
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
        throw new Error(error.error || 'Failed to generate assessment')
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
      toast.success('Draft generated', {
        description: `Review and edit the ${assessment.sections?.length ?? 0} generated section(s) before saving.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate assessment'
      toast.error('Error', { description: message })
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
          <h1 className="mb-4 text-4xl font-bold">Create Assessment</h1>
          <p className="text-xl text-muted-foreground">
            Build skills assessments with sections and questions
          </p>
        </div>

        {/* AI Generation Card — sits outside the form so its inputs don't submit it */}
        <Card className="mx-auto mb-6 max-w-5xl border-primary/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Generate with AI
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Paste a job title and description and let AI draft the sections and questions. You can
              edit everything before saving.
            </p>
            <div>
              <Label htmlFor="genJobTitle">Job Title</Label>
              <Input
                id="genJobTitle"
                value={genJobTitle}
                onChange={(e) => setGenJobTitle(e.target.value)}
                placeholder="e.g., Senior React Developer"
              />
            </div>
            <div>
              <Label htmlFor="genJobDescription">Job Description</Label>
              <textarea
                id="genJobDescription"
                value={genJobDescription}
                onChange={(e) => setGenJobDescription(e.target.value)}
                placeholder="Paste the role responsibilities and required skills..."
                className="min-h-[120px] w-full rounded-md border px-3 py-2"
                rows={4}
              />
            </div>
            <Button type="button" onClick={onGenerate} disabled={isGenerating}>
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
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

        <form onSubmit={handleSubmit(onSubmit)} className="mx-auto max-w-5xl space-y-6">
          {/* Basic Info Card */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="name">Assessment Name</Label>
                <Input
                  id="name"
                  {...register('name')}
                  placeholder="e.g., Senior JavaScript Developer Test"
                />
                {errors.name && (
                  <p className="mt-1 text-sm text-destructive">{errors.name.message}</p>
                )}
              </div>

              <div>
                <Label htmlFor="description">Description (Optional)</Label>
                <textarea
                  id="description"
                  {...register('description')}
                  placeholder="Brief description of this assessment..."
                  className="min-h-[80px] w-full rounded-md border px-3 py-2"
                  rows={3}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Label htmlFor="durationMin">Duration (minutes)</Label>
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
                  <Label htmlFor="passingScore">Passing Score (%)</Label>
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
                  <Label htmlFor="locale">Language</Label>
                  <select
                    id="locale"
                    {...register('locale')}
                    className="w-full rounded-md border px-3 py-2"
                  >
                    <option value="en">English</option>
                    <option value="de">German</option>
                    <option value="sk">Slovak</option>
                    <option value="cs">Czech</option>
                    <option value="pl">Polish</option>
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
                  Randomize question order
                </Label>
              </div>
            </CardContent>
          </Card>

          {/* Sections */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-semibold">
                Sections ({sections.length}) - {totalQuestions} questions total
              </h2>
              <Button type="button" onClick={addSection} variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Add Section
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
                  <p>No sections yet. Click &quot;Add Section&quot; to get started.</p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Submit Button */}
          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || sections.length === 0}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Create Assessment
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
      <CardHeader className="cursor-pointer" onClick={toggleExpanded}>
        <div className="flex items-center justify-between">
          <div className="flex flex-1 items-center gap-3">
            <GripVertical className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-lg">
              Section {sectionIndex + 1} - {questions.length} questions
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Delete section ${sectionIndex + 1}`}
              onClick={(e) => {
                e.stopPropagation()
                removeSection(sectionIndex)
              }}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
            {isExpanded ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          <div>
            <Label>Section Title</Label>
            <Input {...register(`sections.${sectionIndex}.title`)} placeholder="Section title" />
            {sectionErrors?.title && (
              <p className="mt-1 text-sm text-destructive">{sectionErrors.title.message}</p>
            )}
          </div>

          <div>
            <Label>Section Description (Optional)</Label>
            <textarea
              {...register(`sections.${sectionIndex}.description`)}
              placeholder="Brief description..."
              className="min-h-[60px] w-full rounded-md border px-3 py-2"
              rows={2}
            />
          </div>

          {/* Add Question Buttons */}
          <div>
            <Label className="mb-2 block">Add Question</Label>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addQuestion('MCQ')}
                className="text-xs"
              >
                Multiple Choice
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addQuestion('MULTI_SELECT')}
                className="text-xs"
              >
                Multi-Select
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addQuestion('SHORT_TEXT')}
                className="text-xs"
              >
                Short Text
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addQuestion('LONG_TEXT')}
                className="text-xs"
              >
                Long Text
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addQuestion('CODE')}
                className="text-xs"
              >
                Code
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
              <p className="py-4 text-center text-sm text-muted-foreground">
                No questions yet. Click a button above to add one.
              </p>
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
            <Label>Question {questionIndex + 1}</Label>
            <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {questionType.replace('_', ' ')}
            </span>
          </div>
          <textarea
            {...register(`${questionPath}.text`)}
            placeholder="Enter your question..."
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
          aria-label={`Delete question ${questionIndex + 1}`}
          onClick={() => removeQuestion(questionIndex)}
          className="ml-2"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Points</Label>
          <Input
            type="number"
            {...register(`${questionPath}.points`, { valueAsNumber: true })}
            className="h-8"
          />
        </div>
        <div>
          <Label className="text-xs">Skill Tag (Optional)</Label>
          <Input
            {...register(`${questionPath}.skillTag`)}
            placeholder="e.g., JavaScript"
            className="h-8"
          />
        </div>
      </div>

      {/* Type-specific fields */}
      {(questionType === 'MCQ' || questionType === 'MULTI_SELECT') && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Choices</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => appendChoice(`Option ${choices.length + 1}`)}
              className="h-6 text-xs"
            >
              <Plus className="mr-1 h-3 w-3" />
              Add Choice
            </Button>
          </div>
          {choices.map((choice, choiceIndex) => (
            <div key={choice.id} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{choiceIndex + 1}.</span>
              <Input
                {...register(`${questionPath}.choices.${choiceIndex}`)}
                className="h-8 flex-1 text-sm"
                placeholder={`Choice ${choiceIndex + 1}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Delete choice ${choiceIndex + 1}`}
                onClick={() => removeChoice(choiceIndex)}
                className="h-6 px-2"
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
          <div className="mt-2">
            <Label className="text-xs">
              Correct Answer{questionType === 'MULTI_SELECT' ? 's' : ''} (comma-separated indexes,
              e.g., 0,2)
            </Label>
            <Input
              {...register(`${questionPath}.correctIndexes`)}
              className="h-8 text-sm"
              placeholder="0"
            />
          </div>
        </div>
      )}

      {questionType === 'CODE' && (
        <div className="space-y-2">
          <div>
            <Label className="text-xs">Programming Language</Label>
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
            <Label className="text-xs">Starter Code (Optional)</Label>
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
