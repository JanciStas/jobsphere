'use client'

import { useState, useEffect } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { createSequenceSchema, type CreateSequenceInput } from '@/schemas/email-sequence.schema'
import { Plus, Clock, Trash2, Save, Loader2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'

interface EmailSequence {
  id: string
  name: string
  description: string | null
  active: boolean
  steps: Array<{
    id: string
    name: string | null
    order: number
    dayOffset: number
    subject: string
    bodyTemplate: string
    abGroup: string | null
  }>
}

export default function SequencesClient() {
  const [sequences, setSequences] = useState<EmailSequence[]>([])
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<CreateSequenceInput>({
    resolver: zodResolver(createSequenceSchema),
    defaultValues: {
      name: '',
      description: '',
      active: false,
      steps: [
        {
          name: 'Initial Email',
          order: 0,
          dayOffset: 0,
          subject: 'Welcome!',
          bodyTemplate: 'Hi {{candidateName}},\n\nThank you for your interest!',
        },
      ],
    },
  })

  const {
    fields: steps,
    append: appendStep,
    remove: removeStep,
  } = useFieldArray({
    control,
    name: 'steps',
  })

  useEffect(() => {
    loadSequences()
  }, [])

  const loadSequences = async () => {
    try {
      const response = await fetch('/api/sequences')
      if (!response.ok) throw new Error('Failed to load sequences')

      const data = await response.json()
      setSequences(data.sequences)
    } catch (error) {
      toast.error('Error', {
        description: error instanceof Error ? error.message : 'Failed to load sequences',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectSequence = (sequence: EmailSequence) => {
    setSelectedSequenceId(sequence.id)
    reset({
      name: sequence.name,
      description: sequence.description || '',
      active: sequence.active,
      steps: sequence.steps.map((step) => ({
        name: step.name || '',
        order: step.order,
        dayOffset: step.dayOffset,
        subject: step.subject,
        bodyTemplate: step.bodyTemplate,
        abGroup: step.abGroup || undefined,
      })),
    })
  }

  const handleNewSequence = () => {
    setSelectedSequenceId(null)
    reset({
      name: 'New Email Sequence',
      description: '',
      active: false,
      steps: [
        {
          name: 'Initial Email',
          order: 0,
          dayOffset: 0,
          subject: 'Welcome!',
          bodyTemplate: 'Hi {{candidateName}},\n\nThank you for your interest!',
        },
      ],
    })
  }

  const onSubmit = async (data: CreateSequenceInput) => {
    try {
      setIsSubmitting(true)

      const isNew = selectedSequenceId === null
      const url = isNew ? '/api/sequences' : `/api/sequences/${selectedSequenceId}`
      const method = isNew ? 'POST' : 'PATCH'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save sequence')
      }

      const result = await response.json()

      toast.success('Success!', {
        description: isNew ? 'Email sequence created' : 'Email sequence updated',
      })

      await loadSequences()
      setSelectedSequenceId(result.sequence.id)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save sequence'
      toast.error('Error', { description: message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const addStep = () => {
    appendStep({
      name: `Follow-up ${steps.length + 1}`,
      order: steps.length,
      dayOffset: steps.length > 0 ? steps[steps.length - 1].dayOffset + 1 : 1,
      subject: 'Following up',
      bodyTemplate: 'Hi {{candidateName}},\n\nJust checking in...',
    })
  }

  if (isLoading) {
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
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-4xl font-bold">Email Sequences</h1>
            <p className="text-xl text-muted-foreground">Automate candidate engagement campaigns</p>
          </div>
          <Button onClick={handleNewSequence}>
            <Plus className="mr-2 h-4 w-4" />
            New Sequence
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-4">
          {/* Sequences List */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg">Your Sequences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {sequences.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No sequences yet</p>
              )}
              {sequences.map((seq) => (
                <button
                  key={seq.id}
                  onClick={() => handleSelectSequence(seq)}
                  className={`w-full rounded-lg p-3 text-left transition-colors hover:bg-muted ${
                    selectedSequenceId === seq.id ? 'bg-primary/10' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-medium">{seq.name}</p>
                      <p className="text-sm text-muted-foreground">{seq.steps.length} steps</p>
                    </div>
                    {seq.active && (
                      <Badge variant="default" className="text-xs">
                        Active
                      </Badge>
                    )}
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Sequence Editor */}
          <div className="lg:col-span-3">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              {/* Basic Info */}
              <Card>
                <CardHeader>
                  <CardTitle>Sequence Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label htmlFor="name">Sequence Name</Label>
                    <Input
                      id="name"
                      {...register('name')}
                      placeholder="e.g., Welcome & Follow-up Series"
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
                      placeholder="Brief description of this email sequence..."
                      className="min-h-[80px] w-full rounded-md border px-3 py-2"
                      rows={3}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      id="active"
                      type="checkbox"
                      {...register('active')}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="active" className="font-normal">
                      Active (automatically send to new candidates)
                    </Label>
                  </div>
                </CardContent>
              </Card>

              {/* Steps */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-semibold">Email Steps ({steps.length})</h2>
                  <Button type="button" onClick={addStep} variant="outline" size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Step
                  </Button>
                </div>

                {steps.map((step, index) => (
                  <Card key={step.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                            {index + 1}
                          </div>
                          <CardTitle className="text-lg">
                            Step {index + 1}
                            {watch(`steps.${index}.dayOffset`) !== undefined && (
                              <span className="ml-2 text-sm font-normal text-muted-foreground">
                                (Day {watch(`steps.${index}.dayOffset`)})
                              </span>
                            )}
                          </CardTitle>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete step ${index + 1}`}
                          onClick={() => removeStep(index)}
                          disabled={steps.length === 1}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <Label>Step Name (Optional)</Label>
                          <Input
                            {...register(`steps.${index}.name`)}
                            placeholder={`Step ${index + 1}`}
                          />
                        </div>
                        <div>
                          <Label>
                            <Clock className="mr-1 inline h-4 w-4" />
                            Send after (days)
                          </Label>
                          <Input
                            type="number"
                            min={0}
                            {...register(`steps.${index}.dayOffset`, { valueAsNumber: true })}
                          />
                          {errors.steps?.[index]?.dayOffset && (
                            <p className="mt-1 text-sm text-destructive">
                              {errors.steps[index]?.dayOffset?.message}
                            </p>
                          )}
                        </div>
                      </div>

                      <div>
                        <Label>Email Subject</Label>
                        <Input {...register(`steps.${index}.subject`)} placeholder="Subject line" />
                        {errors.steps?.[index]?.subject && (
                          <p className="mt-1 text-sm text-destructive">
                            {errors.steps[index]?.subject?.message}
                          </p>
                        )}
                      </div>

                      <div>
                        <Label>Email Body</Label>
                        <textarea
                          {...register(`steps.${index}.bodyTemplate`)}
                          placeholder="Email content with variables..."
                          className="min-h-[150px] w-full rounded-md border px-3 py-2 font-mono text-sm"
                          rows={8}
                        />
                        {errors.steps?.[index]?.bodyTemplate && (
                          <p className="mt-1 text-sm text-destructive">
                            {errors.steps[index]?.bodyTemplate?.message}
                          </p>
                        )}
                        <div className="mt-2 rounded-lg bg-muted p-3 text-xs">
                          <p className="flex items-center gap-1 font-medium">
                            <Info className="h-3 w-3" />
                            Available variables:
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {'{{candidateName}}'}, {'{{jobTitle}}'}, {'{{companyName}}'}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {steps.length === 0 && (
                  <Card>
                    <CardContent className="py-12 text-center text-muted-foreground">
                      <p>No steps yet. Click &quot;Add Step&quot; to create one.</p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Submit */}
              <div className="flex justify-end gap-4">
                <Button type="button" variant="outline" onClick={() => reset()}>
                  Reset
                </Button>
                <Button type="submit" disabled={isSubmitting || steps.length === 0}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Sequence
                    </>
                  )}
                </Button>
              </div>

              {errors.steps && (
                <p className="text-sm text-destructive">
                  {typeof errors.steps.message === 'string' && errors.steps.message}
                </p>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
