'use client'

import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { UserPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'

const buildInviteSchema = (t: (key: 'invalidEmail' | 'selectRoleError') => string) =>
  z.object({
    email: z.string().email(t('invalidEmail')),
    role: z.enum(['ORG_ADMIN', 'RECRUITER', 'SUB_HR', 'HIRING_MANAGER', 'AGENCY'], {
      required_error: t('selectRoleError'),
    }),
  })

type InviteFormData = z.infer<ReturnType<typeof buildInviteSchema>>

interface InviteMemberDialogProps {
  onSuccess: () => void
}

export function InviteMemberDialog({ onSuccess }: InviteMemberDialogProps) {
  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()
  const t = useTranslations('teamMembers')
  const inviteSchema = useMemo(() => buildInviteSchema((k) => t(k)), [t])

  const form = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: '',
      role: 'RECRUITER',
    },
  })

  const onSubmit = async (data: InviteFormData) => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/organizations/current/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || t('inviteFailed'))
      }

      if (result.emailSent === false) {
        toast.warning(result.message || t('inviteEmailNotSent'))
      } else {
        toast.success(t('inviteSuccess'))
      }

      form.reset()
      setOpen(false)
      onSuccess()
    } catch (error: any) {
      toast.error(error.message || t('inviteFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus className="mr-2 h-4 w-4" />
          {t('inviteMember')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('inviteTitle')}</DialogTitle>
          <DialogDescription>{t('inviteDescription')}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('email')}</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="member@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('role')}</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('selectRole')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="ORG_ADMIN">{t('roles.ORG_ADMIN')}</SelectItem>
                      <SelectItem value="RECRUITER">{t('roles.RECRUITER')}</SelectItem>
                      <SelectItem value="SUB_HR">{t('roles.SUB_HR')}</SelectItem>
                      <SelectItem value="HIRING_MANAGER">{t('roles.HIRING_MANAGER')}</SelectItem>
                      <SelectItem value="AGENCY">{t('roles.AGENCY')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isLoading}
              >
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? t('inviting') : t('invite')}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
