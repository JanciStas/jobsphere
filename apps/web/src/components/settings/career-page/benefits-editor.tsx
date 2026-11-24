'use client'

import { useTranslations } from 'next-intl'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CAREER_LIMITS } from '@/lib/career/media'

interface BenefitsEditorProps {
  value: string[]
  onChange: (value: string[]) => void
}

export function BenefitsEditor({ value, onChange }: BenefitsEditorProps) {
  const t = useTranslations('employerCareerPage.benefits')
  const full = value.length >= CAREER_LIMITS.benefits

  const update = (index: number, text: string) =>
    onChange(value.map((b, i) => (i === index ? text : b)))
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index))

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">{t('label')}</legend>
      <p className="text-sm text-muted-foreground">{t('hint', { max: CAREER_LIMITS.benefits })}</p>
      {value.length === 0 && <p className="text-sm italic text-muted-foreground">{t('empty')}</p>}
      <ul className="space-y-2">
        {value.map((benefit, i) => (
          <li key={i} className="flex items-center gap-2">
            <Label htmlFor={`career-benefit-${i}`} className="sr-only">
              {t('itemLabel', { number: i + 1 })}
            </Label>
            <Input
              id={`career-benefit-${i}`}
              value={benefit}
              maxLength={CAREER_LIMITS.benefit}
              placeholder={t('placeholder')}
              onChange={(e) => update(i, e.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => remove(i)}
              aria-label={t('remove', { number: i + 1 })}
            >
              <X className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, ''])}
        disabled={full}
      >
        <Plus className="mr-2 h-4 w-4" />
        {full ? t('limitReached') : t('add')}
      </Button>
    </fieldset>
  )
}
