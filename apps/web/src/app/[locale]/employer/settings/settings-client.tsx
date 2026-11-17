'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProfileTab } from '@/components/settings/profile-tab'
import { TeamTab } from '@/components/settings/team-tab'
import { BranchesTab } from '@/components/settings/branches-tab'
import { BillingTab } from '@/components/settings/billing-tab'
import { NotificationsTab } from '@/components/settings/notifications-tab'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'

export default function SettingsClient() {
  const params = useParams()
  const locale = params.locale as string
  const t = useTranslations('employer')
  const tp = useTranslations('employerPages')

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto max-w-6xl px-4 py-8">
        {/* Back Button */}
        <Button variant="ghost" asChild className="mb-6">
          <Link href={`/${locale}/employer`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {tp('backToDashboard')}
          </Link>
        </Button>

        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold">{t('companySettings')}</h1>
          <p className="text-muted-foreground">{tp('settingsDescription')}</p>
        </div>

        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 lg:w-auto">
            <TabsTrigger value="profile">Company Profile</TabsTrigger>
            <TabsTrigger value="team">Team Members</TabsTrigger>
            <TabsTrigger value="branches">{t('branches')}</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="notifications">Notifications</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfileTab />
          </TabsContent>

          <TabsContent value="team">
            <TeamTab />
          </TabsContent>

          <TabsContent value="branches">
            <BranchesTab />
          </TabsContent>

          <TabsContent value="billing">
            <BillingTab />
          </TabsContent>

          <TabsContent value="notifications">
            <NotificationsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
