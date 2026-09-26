'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2 } from 'lucide-react'

interface InviteMemberDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: (member: any) => void
}

export function InviteMemberDialog({ open, onOpenChange, onSuccess }: InviteMemberDialogProps) {
  const t = useTranslations('settingsTabs.inviteMember')
  const tRoles = useTranslations('settingsTabs.roles')
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    role: 'RECRUITER',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch('/api/organizations/current/members', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || t('failed'))
      }

      const data = await response.json()

      if (data.emailSent === false) {
        toast.warning(data.message || t('emailFailed'))
      } else {
        toast.success(t('sent', { email: formData.email }))
      }

      // Reset form
      setFormData({ email: '', role: 'RECRUITER' })

      // Call success callback
      onSuccess(data.member)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('emailLabel')}</Label>
            <Input
              id="email"
              type="email"
              placeholder="colleague@example.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
              autoComplete="email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">{t('roleLabel')}</Label>
            <Select
              value={formData.role}
              onValueChange={(value) => setFormData({ ...formData, role: value })}
            >
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ORG_ADMIN">
                  <div className="space-y-0.5">
                    <div className="font-medium">{tRoles('ORG_ADMIN')}</div>
                    <div className="text-xs text-muted-foreground">{t('desc.ORG_ADMIN')}</div>
                  </div>
                </SelectItem>
                <SelectItem value="RECRUITER">
                  <div className="space-y-0.5">
                    <div className="font-medium">{tRoles('RECRUITER')}</div>
                    <div className="text-xs text-muted-foreground">{t('desc.RECRUITER')}</div>
                  </div>
                </SelectItem>
                <SelectItem value="SUB_HR">
                  <div className="space-y-0.5">
                    <div className="font-medium">{tRoles('SUB_HR')}</div>
                    <div className="text-xs text-muted-foreground">{t('desc.SUB_HR')}</div>
                  </div>
                </SelectItem>
                <SelectItem value="HIRING_MANAGER">
                  <div className="space-y-0.5">
                    <div className="font-medium">{tRoles('HIRING_MANAGER')}</div>
                    <div className="text-xs text-muted-foreground">{t('desc.HIRING_MANAGER')}</div>
                  </div>
                </SelectItem>
                <SelectItem value="AGENCY">
                  <div className="space-y-0.5">
                    <div className="font-medium">{tRoles('AGENCY')}</div>
                    <div className="text-xs text-muted-foreground">{t('desc.AGENCY')}</div>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
