'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Building2, Globe, Loader2, Upload, Video, Sparkles } from 'lucide-react'

interface OrganizationData {
  id: string
  name: string
  logo?: string | null
  videoUrl?: string | null
  website?: string | null
  description?: string | null
  industry?: string | null
  size?: string | null
}

const INDUSTRIES = [
  'Technology',
  'Finance',
  'Healthcare',
  'Education',
  'Manufacturing',
  'Retail',
  'Consulting',
  'Marketing',
  'Other',
]

const COMPANY_SIZES = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+']

export function ProfileTab() {
  const t = useTranslations('settingsTabs.profile')
  const { data: session } = useSession()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [orgData, setOrgData] = useState<OrganizationData | null>(null)
  const [logoUploading, setLogoUploading] = useState(false)
  const [videoUploading, setVideoUploading] = useState(false)
  const [generating, setGenerating] = useState(false)

  const logoInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    website: '',
    description: '',
    industry: '',
    size: '',
    logo: '',
    videoUrl: '',
  })

  // Fetch organization data
  useEffect(() => {
    async function fetchOrganization() {
      try {
        const response = await fetch('/api/organizations/current')
        if (!response.ok) throw new Error('Failed to fetch organization')

        const data = await response.json()
        setOrgData(data)
        setFormData({
          name: data.name || '',
          website: data.website || '',
          description: data.description || '',
          industry: data.industry || '',
          size: data.size || '',
          logo: data.logo || '',
          videoUrl: data.videoUrl || '',
        })
      } catch {
        toast.error(t('loadFailed'))
      } finally {
        setLoading(false)
      }
    }

    if (session?.user) {
      fetchOrganization()
    }
  }, [session])

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/upload/logo', { method: 'POST', body })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || t('uploadFailed'))
      }
      const { url } = await res.json()
      setFormData((prev) => ({ ...prev, logo: url }))
      toast.success(t('logoUploaded'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('logoUploadFailed'))
    } finally {
      setLogoUploading(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
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
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || t('uploadFailed'))
      }
      const { url } = await res.json()
      setFormData((prev) => ({ ...prev, videoUrl: url }))
      toast.success(t('videoUploaded'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('videoUploadFailed'))
    } finally {
      setVideoUploading(false)
      if (videoInputRef.current) videoInputRef.current.value = ''
    }
  }

  const handleGenerateProfile = async () => {
    if (!orgData?.id) return
    setGenerating(true)
    try {
      const res = await fetch(`/api/organizations/${orgData.id}/generate-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandText: formData.description }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || t('generateFailed'))
      }
      const { description } = await res.json()
      // Draft only — not persisted until the user hits Save.
      setFormData((prev) => ({ ...prev, description }))
      toast.success(t('generated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('generateFailed'))
    } finally {
      setGenerating(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const response = await fetch(`/api/organizations/${orgData?.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || t('updateFailed'))
      }

      const updated = await response.json()
      setOrgData(updated)

      toast.success(t('updated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('updateFailed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* Logo & Video branding */}
        <div className="mb-8 space-y-6">
          {/* Logo */}
          <div className="space-y-2">
            <Label>{t('logo')}</Label>
            <div className="flex items-center gap-4">
              {formData.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={formData.logo}
                  alt={t('logoAlt')}
                  className="h-16 w-16 rounded-lg border object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-lg border bg-muted">
                  <Building2 className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div className="flex flex-col gap-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={handleLogoUpload}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={logoUploading}
                  onClick={() => logoInputRef.current?.click()}
                >
                  {logoUploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {t('uploadLogo')}
                </Button>
                <p className="text-xs text-muted-foreground">{t('logoHint')}</p>
              </div>
            </div>
          </div>

          {/* Video */}
          <div className="space-y-2">
            <Label>{t('video')}</Label>
            {formData.videoUrl && (
              <video
                controls
                className="w-full max-w-md rounded-lg border bg-black"
                src={formData.videoUrl}
              />
            )}
            <div className="flex flex-col gap-2">
              <input
                ref={videoInputRef}
                type="file"
                accept="video/mp4,video/webm"
                className="hidden"
                onChange={handleVideoUpload}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={videoUploading}
                onClick={() => videoInputRef.current?.click()}
              >
                {videoUploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Video className="mr-2 h-4 w-4" />
                )}
                {t('uploadVideo')}
              </Button>
              <p className="text-xs text-muted-foreground">{t('videoHint')}</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Company Name */}
          <div className="space-y-2">
            <Label htmlFor="name">{t('companyName')}</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              placeholder="Acme Corporation"
            />
          </div>

          {/* Website */}
          <div className="space-y-2">
            <Label htmlFor="website">{t('website')}</Label>
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-muted-foreground" />
              <Input
                id="website"
                type="url"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                placeholder="https://example.com"
              />
            </div>
          </div>

          {/* Industry */}
          <div className="space-y-2">
            <Label htmlFor="industry">{t('industry')}</Label>
            <Select
              value={formData.industry}
              onValueChange={(value) => setFormData({ ...formData, industry: value })}
            >
              <SelectTrigger id="industry">
                <SelectValue placeholder={t('selectIndustry')} />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((industry) => (
                  <SelectItem key={industry} value={industry}>
                    {t(`industries.${industry}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Company Size */}
          <div className="space-y-2">
            <Label htmlFor="size">{t('companySize')}</Label>
            <Select
              value={formData.size}
              onValueChange={(value) => setFormData({ ...formData, size: value })}
            >
              <SelectTrigger id="size">
                <SelectValue placeholder={t('selectSize')} />
              </SelectTrigger>
              <SelectContent>
                {COMPANY_SIZES.map((size) => (
                  <SelectItem key={size} value={size}>
                    {t('employees', { size })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="description">{t('companyDescription')}</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={generating}
                onClick={handleGenerateProfile}
              >
                {generating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {t('generateAi')}
              </Button>
            </div>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={4}
              placeholder={t('descriptionPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">{t('descriptionHint')}</p>
          </div>

          {/* Submit Button */}
          <div className="flex items-center gap-4">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (orgData) {
                  setFormData({
                    name: orgData.name || '',
                    website: orgData.website || '',
                    description: orgData.description || '',
                    industry: orgData.industry || '',
                    size: orgData.size || '',
                    logo: orgData.logo || '',
                    videoUrl: orgData.videoUrl || '',
                  })
                }
              }}
            >
              {t('reset')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
