'use client'

/**
 * Markdown editor shared by every CMS surface: textarea + server-rendered preview
 * (exactly what the public page shows) + optional image upload that inserts ![](url).
 */

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ImagePlus, Eye, Pencil, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

interface MarkdownEditorProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  /** POST endpoint returning { url } for an image (multipart field "file"). Omit to hide the button. */
  uploadUrl?: string
  rows?: number
  maxLength?: number
  required?: boolean
}

export function MarkdownEditor({
  id,
  label,
  value,
  onChange,
  uploadUrl,
  rows = 16,
  maxLength = 100_000,
  required,
}: MarkdownEditorProps) {
  const t = useTranslations('cmsCommon.editor')
  const [mode, setMode] = useState<'write' | 'preview'>('write')
  const [previewHtml, setPreviewHtml] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  async function showPreview() {
    setMode('preview')
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/cms/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: value }),
      })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { html: string }
      setPreviewHtml(data.html)
    } catch {
      setError(t('previewFailed'))
    } finally {
      setBusy(false)
    }
  }

  function insertAtCursor(snippet: string) {
    const el = areaRef.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    onChange(value.slice(0, start) + snippet + value.slice(end))
  }

  async function uploadImage(file: File) {
    if (!uploadUrl) return
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(uploadUrl, { method: 'POST', body: form })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !data.url) throw new Error(data.error || String(res.status))
      insertAtCursor(`\n![${file.name.replace(/[[\]]/g, '')}](${data.url})\n`)
    } catch {
      setError(t('uploadFailed'))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={mode === 'write' ? 'secondary' : 'ghost'}
            onClick={() => setMode('write')}
          >
            <Pencil className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('write')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === 'preview' ? 'secondary' : 'ghost'}
            onClick={showPreview}
          >
            <Eye className="mr-1 h-4 w-4" aria-hidden="true" />
            {t('preview')}
          </Button>
          {uploadUrl && (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus className="mr-1 h-4 w-4" aria-hidden="true" />
                {t('insertImage')}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadImage(f)
                }}
              />
            </>
          )}
        </div>
      </div>

      {mode === 'write' ? (
        <Textarea
          id={id}
          ref={areaRef}
          value={value}
          rows={rows}
          maxLength={maxLength}
          required={required}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-sm"
        />
      ) : (
        <div className="min-h-[12rem] rounded-md border bg-background p-4">
          {busy ? (
            <Loader2
              className="h-5 w-5 animate-spin text-muted-foreground"
              aria-label={t('loading')}
            />
          ) : (
            <div
              className="cms-content"
              // Server-sanitized by renderMarkdown (lib/cms/markdown.ts).
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t('help')}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
