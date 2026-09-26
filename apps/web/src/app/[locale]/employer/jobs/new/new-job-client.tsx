'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  AlertCircle,
  ArrowLeft,
  Briefcase,
  MapPin,
  DollarSign,
  UserCog,
  ImageIcon,
  Video,
  ListChecks,
  Upload,
  Plus,
  X,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import Link from 'next/link'
import { logger } from '@/lib/logger'

// Validation schema
const jobSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(100),
  description: z.string().min(50, 'Description must be at least 50 characters').max(5000),
  requirements: z.string().min(20, 'Requirements must be at least 20 characters').max(3000),
  benefits: z.string().optional(),
  location: z.string().min(2, 'Location is required'),
  salaryMin: z.number().min(0).optional().or(z.literal('')),
  salaryMax: z.number().min(0).optional().or(z.literal('')),
  currency: z.string().default('EUR'),
  workMode: z.enum(['REMOTE', 'HYBRID', 'ONSITE']),
  type: z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'FREELANCE', 'INTERNSHIP']),
  seniority: z.enum(['JUNIOR', 'MID', 'SENIOR', 'LEAD', 'EXECUTIVE']),
  department: z.string().optional(),
  keywords: z.string().optional(),
  // PR5 — sub-HR assignment, ad media, and screening (extra questions OR a test).
  assignedRecruiterId: z.string().optional(),
  imageUrl: z.string().optional(),
  videoUrl: z.string().optional(),
  screeningMode: z.enum(['NONE', 'QUESTIONS', 'ASSESSMENT']).default('NONE'),
  assessmentId: z.string().optional(),
  screeningQuestions: z.array(z.string()).optional(),
})

type JobFormData = z.infer<typeof jobSchema>

interface OrgMember {
  user: { id: string; name: string | null; email: string | null }
  role: string
}

interface OrgAssessment {
  id: string
  name: string
  isPublished: boolean
}

export default function NewJobClient({ params }: { params: { locale: string } }) {
  const router = useRouter()
  const t = useTranslations()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [members, setMembers] = useState<OrgMember[]>([])
  const [assessments, setAssessments] = useState<OrgAssessment[]>([])
  const [logoUploading, setLogoUploading] = useState(false)
  const [videoUploading, setVideoUploading] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
  } = useForm<JobFormData>({
    resolver: zodResolver(jobSchema),
    defaultValues: {
      workMode: 'ONSITE',
      type: 'FULL_TIME',
      seniority: 'MID',
      currency: 'EUR',
      screeningMode: 'NONE',
      screeningQuestions: [],
    },
  })

  // Fetch org members (for sub-HR assignment) and assessments (for the test picker).
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [membersRes, assessmentsRes] = await Promise.all([
          fetch('/api/organizations/current/members'),
          fetch('/api/assessments'),
        ])
        if (active && membersRes.ok) {
          const data = await membersRes.json()
          setMembers(Array.isArray(data.members) ? data.members : [])
        }
        if (active && assessmentsRes.ok) {
          const data = await assessmentsRes.json()
          setAssessments(Array.isArray(data.assessments) ? data.assessments : [])
        }
      } catch (error) {
        logger.error('Failed to load job-form metadata', error)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const screeningMode = watch('screeningMode')
  const assignedRecruiterId = watch('assignedRecruiterId')
  const assessmentId = watch('assessmentId')
  const imageUrl = watch('imageUrl')
  const videoUrl = watch('videoUrl')
  const screeningQuestions = watch('screeningQuestions') ?? []

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/upload/logo', { method: 'POST', body })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Upload failed')
      setValue('imageUrl', result.url)
      toast.success(t('employer.newJob.imageUploaded'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload image')
    } finally {
      setLogoUploading(false)
    }
  }

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setVideoUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/upload/video', { method: 'POST', body })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'Upload failed')
      setValue('videoUrl', result.url)
      toast.success(t('employer.newJob.videoUploaded'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to upload video')
    } finally {
      setVideoUploading(false)
    }
  }

  const addQuestion = () => setValue('screeningQuestions', [...screeningQuestions, ''])
  const updateQuestion = (index: number, value: string) => {
    const next = [...screeningQuestions]
    next[index] = value
    setValue('screeningQuestions', next)
  }
  const removeQuestion = (index: number) =>
    setValue(
      'screeningQuestions',
      screeningQuestions.filter((_, i) => i !== index),
    )

  const onSubmit = async (data: JobFormData) => {
    setIsSubmitting(true)

    try {
      // Convert empty strings to undefined for optional numeric fields, and
      // fold the PR5 screening selection into the API's canonical fields.
      const processedData = {
        ...data,
        salaryMin: data.salaryMin === '' ? undefined : Number(data.salaryMin),
        salaryMax: data.salaryMax === '' ? undefined : Number(data.salaryMax),
        salaryCurrency: data.currency,
        assignedRecruiterId: data.assignedRecruiterId || undefined,
        imageUrl: data.imageUrl || undefined,
        videoUrl: data.videoUrl || undefined,
        requiresAssessment: data.screeningMode === 'ASSESSMENT',
        assessmentId:
          data.screeningMode === 'ASSESSMENT' ? data.assessmentId || undefined : undefined,
        screeningQuestions:
          data.screeningMode === 'QUESTIONS'
            ? (data.screeningQuestions ?? []).map((q) => q.trim()).filter(Boolean)
            : undefined,
      }

      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(processedData),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create job')
      }

      toast.success(t('employer.newJob.jobPostedSuccess'))
      router.push(`/${params.locale}/employer`)
      // The API revalidates the server cache, but the client Router Cache can still
      // serve the previous /employer list for up to 30s — refresh so the new job shows.
      router.refresh()
    } catch (error) {
      logger.error('Failed to create job', error)
      toast.error(error instanceof Error ? error.message : 'Failed to create job')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto max-w-4xl px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Button variant="ghost" size="sm" asChild className="mb-4">
            <Link href={`/${params.locale}/employer`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('employer.backToDashboard')}
            </Link>
          </Button>
          <h1 className="mb-2 text-3xl font-bold">{t('employer.newJob.title')}</h1>
          <p className="text-muted-foreground">{t('employer.newJob.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                {t('employer.newJob.basicInfo')}
              </CardTitle>
              <CardDescription>{t('employer.newJob.basicInfoDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">{t('employer.newJob.jobTitle')} *</Label>
                <Input
                  id="title"
                  placeholder={t('employer.newJob.jobTitlePlaceholder')}
                  {...register('title')}
                />
                {errors.title && (
                  <p className="flex items-center gap-1 text-sm text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {errors.title.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="type">{t('employer.newJob.employmentType')} *</Label>
                  <Select
                    onValueChange={(value) => setValue('type', value as any)}
                    defaultValue="FULL_TIME"
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FULL_TIME">{t('employer.newJob.fullTime')}</SelectItem>
                      <SelectItem value="PART_TIME">{t('employer.newJob.partTime')}</SelectItem>
                      <SelectItem value="CONTRACT">{t('employer.newJob.contract')}</SelectItem>
                      <SelectItem value="FREELANCE">{t('employer.newJob.freelance')}</SelectItem>
                      <SelectItem value="INTERNSHIP">{t('employer.newJob.internship')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="seniority">{t('employer.newJob.seniorityLevel')} *</Label>
                  <Select
                    onValueChange={(value) => setValue('seniority', value as any)}
                    defaultValue="MID"
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="JUNIOR">{t('employer.newJob.junior')}</SelectItem>
                      <SelectItem value="MID">{t('employer.newJob.mid')}</SelectItem>
                      <SelectItem value="SENIOR">{t('employer.newJob.senior')}</SelectItem>
                      <SelectItem value="LEAD">{t('employer.newJob.lead')}</SelectItem>
                      <SelectItem value="EXECUTIVE">{t('employer.newJob.executive')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="department">{t('employer.newJob.department')}</Label>
                <Input
                  id="department"
                  placeholder={t('employer.newJob.departmentPlaceholder')}
                  {...register('department')}
                />
              </div>
            </CardContent>
          </Card>

          {/* PR5 (L7) — Sub-HR recruiter assignment */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCog className="h-5 w-5" />
                {t('employer.newJob.assignRecruiter')}
              </CardTitle>
              <CardDescription>{t('employer.newJob.assignRecruiterDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="assignedRecruiterId">{t('employer.newJob.recruiter')}</Label>
                <Select
                  value={assignedRecruiterId ?? 'none'}
                  onValueChange={(value) =>
                    setValue('assignedRecruiterId', value === 'none' ? undefined : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('employer.newJob.recruiterPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('employer.newJob.unassigned')}</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.user.id} value={m.user.id}>
                        {m.user.name || m.user.email || m.user.id}
                        {m.role ? ` · ${m.role}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* PR5 (L38) — Ad media (image + video) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5" />
                {t('employer.newJob.media')}
              </CardTitle>
              <CardDescription>{t('employer.newJob.mediaDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Image */}
              <div className="space-y-2">
                <Label>{t('employer.newJob.adImage')}</Label>
                {imageUrl ? (
                  <div className="space-y-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl}
                      alt="Job ad preview"
                      className="max-h-40 rounded-md border object-cover"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setValue('imageUrl', undefined)}
                    >
                      <X className="mr-2 h-4 w-4" />
                      {t('employer.newJob.removeImage')}
                    </Button>
                  </div>
                ) : (
                  <div>
                    <input
                      id="imageUpload"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleImageUpload}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={logoUploading}
                      onClick={() => document.getElementById('imageUpload')?.click()}
                    >
                      {logoUploading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      {t('employer.newJob.uploadImage')}
                    </Button>
                  </div>
                )}
              </div>

              {/* Video */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Video className="h-4 w-4" />
                  {t('employer.newJob.adVideo')}
                </Label>
                {videoUrl ? (
                  <div className="space-y-2">
                    <video src={videoUrl} controls className="max-h-48 rounded-md border" />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setValue('videoUrl', undefined)}
                    >
                      <X className="mr-2 h-4 w-4" />
                      {t('employer.newJob.removeVideo')}
                    </Button>
                  </div>
                ) : (
                  <div>
                    <input
                      id="videoUpload"
                      type="file"
                      accept="video/mp4,video/webm"
                      className="hidden"
                      onChange={handleVideoUpload}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={videoUploading}
                      onClick={() => document.getElementById('videoUpload')?.click()}
                    >
                      {videoUploading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="mr-2 h-4 w-4" />
                      )}
                      {t('employer.newJob.uploadVideo')}
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Location & Work Mode */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                {t('employer.newJob.locationWorkMode')}
              </CardTitle>
              <CardDescription>{t('employer.newJob.locationWorkModeDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="location">{t('employer.newJob.location')} *</Label>
                <Input
                  id="location"
                  placeholder={t('employer.newJob.locationPlaceholder')}
                  {...register('location')}
                />
                {errors.location && (
                  <p className="flex items-center gap-1 text-sm text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {errors.location.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="workMode">{t('employer.newJob.workMode')} *</Label>
                <Select
                  onValueChange={(value) => setValue('workMode', value as any)}
                  defaultValue="ONSITE"
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ONSITE">{t('employer.newJob.onsite')}</SelectItem>
                    <SelectItem value="HYBRID">{t('employer.newJob.hybrid')}</SelectItem>
                    <SelectItem value="REMOTE">{t('employer.newJob.remote')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Job Description */}
          <Card>
            <CardHeader>
              <CardTitle>{t('employer.newJob.jobDescription')}</CardTitle>
              <CardDescription>{t('employer.newJob.jobDescriptionDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="description">{t('employer.newJob.description')} *</Label>
                <Textarea
                  id="description"
                  placeholder={t('employer.newJob.descriptionPlaceholder')}
                  rows={8}
                  {...register('description')}
                />
                {errors.description && (
                  <p className="flex items-center gap-1 text-sm text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {errors.description.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="requirements">{t('employer.newJob.requirements')} *</Label>
                <Textarea
                  id="requirements"
                  placeholder={t('employer.newJob.requirementsPlaceholder')}
                  rows={6}
                  {...register('requirements')}
                />
                {errors.requirements && (
                  <p className="flex items-center gap-1 text-sm text-destructive">
                    <AlertCircle className="h-3 w-3" />
                    {errors.requirements.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="benefits">{t('employer.newJob.benefits')}</Label>
                <Textarea
                  id="benefits"
                  placeholder={t('employer.newJob.benefitsPlaceholder')}
                  rows={4}
                  {...register('benefits')}
                />
              </div>
            </CardContent>
          </Card>

          {/* Compensation */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                {t('employer.newJob.compensation')}
              </CardTitle>
              <CardDescription>{t('employer.newJob.compensationDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="salaryMin">{t('employer.newJob.minSalary')}</Label>
                  <Input
                    id="salaryMin"
                    type="number"
                    placeholder="3000"
                    {...register('salaryMin', { valueAsNumber: true })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="salaryMax">{t('employer.newJob.maxSalary')}</Label>
                  <Input
                    id="salaryMax"
                    type="number"
                    placeholder="5000"
                    {...register('salaryMax', { valueAsNumber: true })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency">{t('employer.newJob.currency')}</Label>
                  <Select onValueChange={(value) => setValue('currency', value)} defaultValue="EUR">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="CZK">CZK</SelectItem>
                      <SelectItem value="PLN">PLN</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* SEO & Keywords */}
          <Card>
            <CardHeader>
              <CardTitle>{t('employer.newJob.keywords')}</CardTitle>
              <CardDescription>{t('employer.newJob.keywordsDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="keywords">{t('employer.newJob.keywordsLabel')}</Label>
                <Input
                  id="keywords"
                  placeholder={t('employer.newJob.keywordsPlaceholder')}
                  {...register('keywords')}
                />
                <p className="text-sm text-muted-foreground">{t('employer.newJob.keywordsHint')}</p>
              </div>
            </CardContent>
          </Card>

          {/* PR5 (L52/L54) — Screening: extra questions OR a linked test */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ListChecks className="h-5 w-5" />
                {t('employer.newJob.screening')}
              </CardTitle>
              <CardDescription>{t('employer.newJob.screeningDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <RadioGroup
                value={screeningMode}
                onValueChange={(value) =>
                  setValue('screeningMode', value as JobFormData['screeningMode'])
                }
              >
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="NONE" id="screening-none" />
                  <Label htmlFor="screening-none" className="font-normal">
                    {t('employer.newJob.screeningNone')}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="QUESTIONS" id="screening-questions" />
                  <Label htmlFor="screening-questions" className="font-normal">
                    {t('employer.newJob.screeningQuestions')}
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="ASSESSMENT" id="screening-assessment" />
                  <Label htmlFor="screening-assessment" className="font-normal">
                    {t('employer.newJob.screeningAssessment')}
                  </Label>
                </div>
              </RadioGroup>

              {screeningMode === 'QUESTIONS' && (
                <div className="space-y-3 rounded-md border p-4">
                  {screeningQuestions.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t('employer.newJob.noQuestionsYet')}
                    </p>
                  )}
                  {screeningQuestions.map((q, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={q}
                        placeholder={t('employer.newJob.questionPlaceholder')}
                        maxLength={2000}
                        onChange={(e) => updateQuestion(index, e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeQuestion(index)}
                        aria-label={t('employer.newJob.removeQuestion')}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  {screeningQuestions.length < 50 && (
                    <Button type="button" variant="outline" size="sm" onClick={addQuestion}>
                      <Plus className="mr-2 h-4 w-4" />
                      {t('employer.newJob.addQuestion')}
                    </Button>
                  )}
                </div>
              )}

              {screeningMode === 'ASSESSMENT' && (
                <div className="space-y-2 rounded-md border p-4">
                  <Label htmlFor="assessmentId">{t('employer.newJob.selectAssessment')}</Label>
                  {assessments.length > 0 ? (
                    <Select
                      value={assessmentId ?? ''}
                      onValueChange={(value) => setValue('assessmentId', value)}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t('employer.newJob.selectAssessmentPlaceholder')}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {assessments.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                            {a.isPublished ? '' : ` (${t('employer.newJob.draft')})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {t('employer.newJob.noAssessments')}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('employer.newJob.publishing') : t('employer.newJob.publish')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
