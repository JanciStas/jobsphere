'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Loader2, RotateCcw, Save } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface TextRow {
  key: string
  group: 'home' | 'pricing' | 'forEmployers'
  label: string
  builtIn: string
  override: string | null
}

const GROUPS = ['home', 'pricing', 'forEmployers'] as const

export function TextsEditor({
  lang,
  rows,
  maxLength,
}: {
  lang: string
  rows: TextRow[]
  maxLength: number
}) {
  const t = useTranslations('adminCmsTexts')
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.key, r.override ?? ''])),
  )
  const [busy, setBusy] = useState<string | null>(null)

  async function request(key: string, init: RequestInit & { url: string }, success: string) {
    setBusy(key)
    try {
      const res = await fetch(init.url, {
        method: init.method,
        body: init.body,
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { code?: string }
        toast.error(data.code === 'cms_not_migrated' ? t('notMigrated') : t('saveFailed'))
        return false
      }
      toast.success(success)
      router.refresh()
      return true
    } catch {
      toast.error(t('saveFailed'))
      return false
    } finally {
      setBusy(null)
    }
  }

  function save(row: TextRow) {
    void request(
      row.key,
      {
        url: '/api/admin/cms/texts',
        method: 'PUT',
        body: JSON.stringify({ key: row.key, locale: lang, value: values[row.key].trim() }),
      },
      t('saved'),
    )
  }

  async function reset(row: TextRow) {
    const params = new URLSearchParams({ key: row.key, locale: lang })
    const ok = await request(
      row.key,
      { url: `/api/admin/cms/texts?${params}`, method: 'DELETE' },
      t('resetDone'),
    )
    if (ok) setValues((v) => ({ ...v, [row.key]: '' }))
  }

  return (
    <div className="space-y-8">
      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`texts-${group}`} className="space-y-4">
          <h3 id={`texts-${group}`} className="text-lg font-semibold">
            {t(`groups.${group}`)}
          </h3>
          {rows
            .filter((row) => row.group === group)
            .map((row) => {
              const id = `text-${row.key.replace(/\./g, '-')}`
              const value = values[row.key] ?? ''
              const trimmed = value.trim()
              const dirty = trimmed !== (row.override ?? '')
              return (
                <div key={row.key} className="space-y-2 rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={id} className="font-medium">
                      {row.label}
                    </Label>
                    <code className="text-xs text-muted-foreground">{row.key}</code>
                    {row.override !== null && (
                      <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
                        {t('overridden')}
                      </Badge>
                    )}
                  </div>
                  <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                    <span className="font-medium">{t('builtIn')}:</span> {row.builtIn}
                  </p>
                  <Textarea
                    id={id}
                    rows={2}
                    maxLength={maxLength}
                    placeholder={t('placeholder')}
                    value={value}
                    onChange={(e) => setValues((v) => ({ ...v, [row.key]: e.target.value }))}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!trimmed || !dirty || busy !== null}
                      onClick={() => save(row)}
                    >
                      {busy === row.key ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" aria-hidden="true" />
                      )}
                      {t('save')}
                    </Button>
                    {row.override !== null && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => reset(row)}
                      >
                        <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
                        {t('reset')}
                      </Button>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground">
                      {value.length}/{maxLength}
                    </span>
                  </div>
                </div>
              )
            })}
        </section>
      ))}
    </div>
  )
}
