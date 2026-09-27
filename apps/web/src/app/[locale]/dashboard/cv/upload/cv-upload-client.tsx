'use client'

/**
 * CV Upload & Parse Flow
 * Upload PDF/DOCX → Extract text → Parse with Claude → Edit & Save
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Upload, FileText, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { logger } from '@/lib/logger'

type UploadStatus = 'idle' | 'uploading' | 'parsing' | 'success' | 'error'

export default function CVUploadClient() {
  const router = useRouter()
  const t = useTranslations('cvUpload')
  const params = useParams()
  const locale = (params?.locale as string) || 'sk'
  const [status, setStatus] = useState<UploadStatus>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Only the setter is used (it re-renders on success); the value itself is never read.
  const [, setCvId] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      // Validate file type
      const validTypes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
      ]
      if (!validTypes.includes(selectedFile.type)) {
        setError(t('invalidType'))
        return
      }

      // Validate file size (max 10MB)
      if (selectedFile.size > 10 * 1024 * 1024) {
        setError(t('tooLarge'))
        return
      }

      setFile(selectedFile)
      setError(null)
    }
  }

  const handleUpload = async () => {
    if (!file) return

    try {
      setStatus('uploading')
      setError(null)

      // 1. Upload file to Vercel Blob
      const formData = new FormData()
      formData.append('file', file)

      const uploadResponse = await fetch('/api/cv/upload', {
        method: 'POST',
        body: formData,
      })

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file')
      }

      const { url, rawText, filename, mime, size, hash } = await uploadResponse.json()

      // 2. Parse CV with Claude (forward the stored-file reference so the parse
      // step can persist a CandidateDocument and link it to the Resume).
      setStatus('parsing')

      const parseResponse = await fetch('/api/cv/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText, fileUrl: url, filename, mime, size, hash }),
      })

      if (!parseResponse.ok) {
        throw new Error('Failed to parse CV')
      }

      const { cvId: newCvId } = await parseResponse.json()

      // 3. Success - redirect to edit page
      setStatus('success')
      setCvId(newCvId)

      setTimeout(() => {
        router.push(`/${locale}/dashboard/cv/${newCvId}/edit`)
      }, 1500)
    } catch (err) {
      logger.error('Upload error', err)
      setStatus('error')
      setError(err instanceof Error ? err.message : t('uploadFailed'))
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-lg bg-white p-8 shadow-sm">
          {/* Header */}
          <div className="mb-8 text-center">
            <FileText className="mx-auto mb-4 h-12 w-12 text-primary" />
            <h1 className="mb-2 text-3xl font-bold text-gray-900">{t('title')}</h1>
            <p className="text-gray-600">{t('subtitle')}</p>
          </div>

          {/* Upload Area */}
          <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center transition-colors hover:border-primary">
            <input
              type="file"
              id="cv-upload"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt"
              onChange={handleFileChange}
              disabled={status !== 'idle' && status !== 'error'}
            />
            <label htmlFor="cv-upload" className="flex cursor-pointer flex-col items-center">
              <Upload className="mb-4 h-16 w-16 text-gray-400" />
              <p className="mb-2 text-lg font-medium text-gray-900">
                {file ? file.name : t('dropPrompt')}
              </p>
              <p className="text-sm text-gray-500">{t('fileHint')}</p>
            </label>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mt-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
              <XCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Status Messages */}
          {status === 'uploading' && (
            <div className="mt-6 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              <p className="text-sm text-blue-800">{t('uploading')}</p>
            </div>
          )}

          {status === 'parsing' && (
            <div className="mt-6 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
              <p className="text-sm text-blue-800">{t('parsing')}</p>
            </div>
          )}

          {status === 'success' && (
            <div className="mt-6 flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <p className="text-sm text-green-800">{t('success')}</p>
            </div>
          )}

          {/* Upload Button */}
          <button
            onClick={handleUpload}
            disabled={!file || status !== 'idle'}
            className="mt-8 w-full rounded-lg bg-primary px-6 py-3 font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {status === 'idle' ? t('submit') : t('processing')}
          </button>

          {/* Info */}
          <div className="mt-8 rounded-lg bg-gray-50 p-4">
            <h3 className="mb-2 font-medium text-gray-900">{t('nextTitle')}</h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="text-primary">1.</span>
                <span>{t('step1')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">2.</span>
                <span>{t('step2')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">3.</span>
                <span>{t('step3')}</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">4.</span>
                <span>{t('step4')}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
