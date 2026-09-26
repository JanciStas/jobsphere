'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { Bell, Loader2, Mail } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface NotificationPreferences {
  emailNotifications: {
    newApplication: boolean
    applicationStatusChange: boolean
    newTeamMember: boolean
    billingUpdates: boolean
    weeklyDigest: boolean
    marketingEmails: boolean
  }
  inAppNotifications: {
    newApplication: boolean
    applicationStatusChange: boolean
    newTeamMember: boolean
    mentions: boolean
  }
  digestFrequency: 'immediate' | 'daily' | 'weekly'
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  emailNotifications: {
    newApplication: true,
    applicationStatusChange: true,
    newTeamMember: true,
    billingUpdates: true,
    weeklyDigest: true,
    marketingEmails: false,
  },
  inAppNotifications: {
    newApplication: true,
    applicationStatusChange: true,
    newTeamMember: true,
    mentions: true,
  },
  digestFrequency: 'immediate',
}

export function NotificationsTab() {
  const t = useTranslations('settingsTabs.notifications')
  const { data: session } = useSession()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES)

  // Fetch notification preferences
  useEffect(() => {
    async function fetchPreferences() {
      try {
        const response = await fetch('/api/user/preferences')
        if (!response.ok) throw new Error('Failed to fetch preferences')

        const data = await response.json()
        if (data.preferences) {
          setPreferences(data.preferences)
        }
      } catch {
        toast.error(t('loadFailed'))
      } finally {
        setLoading(false)
      }
    }

    if (session?.user) {
      fetchPreferences()
    }
  }, [session, toast])

  const handleSave = async () => {
    setSaving(true)

    try {
      const response = await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ preferences }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || t('saveFailed'))
      }

      toast.success(t('saved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const updateEmailPref = (
    key: keyof NotificationPreferences['emailNotifications'],
    value: boolean,
  ) => {
    setPreferences({
      ...preferences,
      emailNotifications: {
        ...preferences.emailNotifications,
        [key]: value,
      },
    })
  }

  const updateInAppPref = (
    key: keyof NotificationPreferences['inAppNotifications'],
    value: boolean,
  ) => {
    setPreferences({
      ...preferences,
      inAppNotifications: {
        ...preferences.inAppNotifications,
        [key]: value,
      },
    })
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
    <div className="space-y-6">
      {/* Email Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            {t('emailTitle')}
          </CardTitle>
          <CardDescription>{t('emailDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="email-new-app">{t('newApplication')}</Label>
                <p className="text-sm text-muted-foreground">{t('emailNewApplicationDesc')}</p>
              </div>
              <Switch
                id="email-new-app"
                checked={preferences.emailNotifications.newApplication}
                onCheckedChange={(checked) => updateEmailPref('newApplication', checked)}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="email-status-change">{t('statusChanged')}</Label>
                <p className="text-sm text-muted-foreground">{t('emailStatusDesc')}</p>
              </div>
              <Switch
                id="email-status-change"
                checked={preferences.emailNotifications.applicationStatusChange}
                onCheckedChange={(checked) => updateEmailPref('applicationStatusChange', checked)}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="email-team">{t('newTeamMemberAdded')}</Label>
                <p className="text-sm text-muted-foreground">{t('emailTeamDesc')}</p>
              </div>
              <Switch
                id="email-team"
                checked={preferences.emailNotifications.newTeamMember}
                onCheckedChange={(checked) => updateEmailPref('newTeamMember', checked)}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="email-billing">{t('billingUpdates')}</Label>
                <p className="text-sm text-muted-foreground">{t('emailBillingDesc')}</p>
              </div>
              <Switch
                id="email-billing"
                checked={preferences.emailNotifications.billingUpdates}
                onCheckedChange={(checked) => updateEmailPref('billingUpdates', checked)}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="email-weekly">{t('weeklyDigest')}</Label>
                <p className="text-sm text-muted-foreground">{t('emailWeeklyDesc')}</p>
              </div>
              <Switch
                id="email-weekly"
                checked={preferences.emailNotifications.weeklyDigest}
                onCheckedChange={(checked) => updateEmailPref('weeklyDigest', checked)}
              />
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="email-marketing">{t('marketingEmails')}</Label>
                <p className="text-sm text-muted-foreground">{t('emailMarketingDesc')}</p>
              </div>
              <Switch
                id="email-marketing"
                checked={preferences.emailNotifications.marketingEmails}
                onCheckedChange={(checked) => updateEmailPref('marketingEmails', checked)}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="digest-freq">{t('digestFrequency')}</Label>
            <Select
              value={preferences.digestFrequency}
              onValueChange={(value: 'immediate' | 'daily' | 'weekly') =>
                setPreferences({ ...preferences, digestFrequency: value })
              }
            >
              <SelectTrigger id="digest-freq" className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">{t('immediate')}</SelectItem>
                <SelectItem value="daily">{t('dailyDigest')}</SelectItem>
                <SelectItem value="weekly">{t('weeklyDigestOption')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('digestFrequencyDesc')}</p>
          </div>
        </CardContent>
      </Card>

      {/* In-App Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            {t('inAppTitle')}
          </CardTitle>
          <CardDescription>{t('inAppDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="app-new-app">{t('newApplication')}</Label>
              <p className="text-sm text-muted-foreground">{t('appNewApplicationDesc')}</p>
            </div>
            <Switch
              id="app-new-app"
              checked={preferences.inAppNotifications.newApplication}
              onCheckedChange={(checked) => updateInAppPref('newApplication', checked)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="app-status">{t('statusChanged')}</Label>
              <p className="text-sm text-muted-foreground">{t('appStatusDesc')}</p>
            </div>
            <Switch
              id="app-status"
              checked={preferences.inAppNotifications.applicationStatusChange}
              onCheckedChange={(checked) => updateInAppPref('applicationStatusChange', checked)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="app-team">{t('newTeamMember')}</Label>
              <p className="text-sm text-muted-foreground">{t('appTeamDesc')}</p>
            </div>
            <Switch
              id="app-team"
              checked={preferences.inAppNotifications.newTeamMember}
              onCheckedChange={(checked) => updateInAppPref('newTeamMember', checked)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="app-mentions">{t('mentions')}</Label>
              <p className="text-sm text-muted-foreground">{t('appMentionsDesc')}</p>
            </div>
            <Switch
              id="app-mentions"
              checked={preferences.inAppNotifications.mentions}
              onCheckedChange={(checked) => updateInAppPref('mentions', checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('save')}
        </Button>
        <Button variant="outline" onClick={() => setPreferences(DEFAULT_PREFERENCES)}>
          {t('reset')}
        </Button>
      </div>
    </div>
  )
}
