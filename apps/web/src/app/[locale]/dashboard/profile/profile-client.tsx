'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Upload, User, Briefcase, MapPin, Mail, Phone } from 'lucide-react'

export default function ProfileClient({ params }: { params: { locale: string } }) {
  const locale = params.locale
  const t = useTranslations('profilePage')
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    // Simulate save
    await new Promise((resolve) => setTimeout(resolve, 1000))
    setSaving(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto max-w-4xl px-4 py-8">
        {/* Back Button */}
        <Button variant="ghost" asChild className="mb-6">
          <Link href={`/${locale}/dashboard`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('backToDashboard')}
          </Link>
        </Button>

        <div className="mb-6">
          <h1 className="mb-2 text-3xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>

        <div className="space-y-6">
          {/* Personal Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                {t('personalInfo')}
              </CardTitle>
              <CardDescription>{t('personalInfoDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">{t('firstName')}</Label>
                    <Input id="firstName" defaultValue="Ján" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">{t('lastName')}</Label>
                    <Input id="lastName" defaultValue="Novák" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">{t('email')}</Label>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <Input id="email" type="email" defaultValue="jan.novak@example.com" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">{t('phone')}</Label>
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    <Input id="phone" type="tel" defaultValue="+421 900 123 456" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">{t('location')}</Label>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <Input id="location" defaultValue="Bratislava, Slovakia" />
                  </div>
                </div>

                <Button type="submit" disabled={saving}>
                  {saving ? t('saving') : t('saveChanges')}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* CV Upload */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                {t('cvTitle')}
              </CardTitle>
              <CardDescription>{t('cvDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border-2 border-dashed p-8 text-center">
                <Upload className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
                <p className="mb-2 text-sm text-muted-foreground">{t('dropPrompt')}</p>
                <p className="mb-4 text-xs text-muted-foreground">{t('fileHint')}</p>
                <Button variant="outline">{t('chooseFile')}</Button>
              </div>

              <div className="rounded-lg bg-muted/50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p className="text-sm font-medium">CV_Jan_Novak_2024.pdf</p>
                    <p className="text-xs text-muted-foreground">{t('uploadedMeta')}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline">
                      {t('view')}
                    </Button>
                    <Button size="sm" variant="ghost">
                      {t('remove')}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Work Preferences */}
          <Card>
            <CardHeader>
              <CardTitle>{t('workPrefs')}</CardTitle>
              <CardDescription>{t('workPrefsDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="jobTitle">{t('preferredRole')}</Label>
                  <Input id="jobTitle" defaultValue="Senior React Developer" />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="minSalary">{t('minSalary')}</Label>
                    <Input id="minSalary" type="number" defaultValue="3000" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxSalary">{t('maxSalary')}</Label>
                    <Input id="maxSalary" type="number" defaultValue="5000" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('workMode')}</Label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm">
                      {t('remote')}
                    </Button>
                    <Button type="button" variant="default" size="sm">
                      {t('hybrid')}
                    </Button>
                    <Button type="button" variant="outline" size="sm">
                      {t('onsite')}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="skills">{t('skills')}</Label>
                  <Input
                    id="skills"
                    defaultValue="React, TypeScript, Next.js, Node.js, GraphQL"
                    placeholder="React, TypeScript, Node.js..."
                  />
                </div>

                <Button type="submit">{t('savePrefs')}</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
