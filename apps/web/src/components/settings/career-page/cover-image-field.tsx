'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { isHttpsUrl } from '@/lib/career/media'

export const CAREER_UPLOAD_URL = '/api/employer/career-page/upload'

interface CoverImageFieldProps {
  value: string
  onChange: (value: string) => void
}

export function CoverImageField({ value, onChange }: CoverImageFieldProps) {
  const t = useTranslations('employerCareerPage.cover')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(CAREER_UPLOAD_URL, { method: 'POST', body })
      const data = (await res.json().catch(() => ({}))) as { url?: string; code?: string }
      if (!res.ok || !data.url) {
        const key =
          data.code === 'too_large'
            ? 'tooLarge'
            : data.code === 'invalid_type'
              ? 'invalidType'
              : 'uploadFailed'
        toast.error(t(key))
        return
      }
      onChange(data.url)
      toast.success(t('uploaded'))
    } catch {
      toast.error(t('uploadFailed'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-3">
      <Label>{t('label')}</Label>
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      {isHttpsUrl(value) ? (
        // eslint-disable-next-line @next/next/no-img-element -- Vercel Blob preview
        <img
          src={value}
          alt={t('previewAlt')}
          className="aspect-[3/1] w-full rounded-lg border object-cover"
        />
      ) : (
        <div className="flex aspect-[3/1] w-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
          {t('none')}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={upload}
          aria-label={t('upload')}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="mr-2 h-4 w-4" />
          )}
          {uploading ? t('uploading') : value ? t('replace') : t('upload')}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
            <Trash2 className="mr-2 h-4 w-4" />
            {t('remove')}
          </Button>
        )}
      </div>
    </div>
  )
}
