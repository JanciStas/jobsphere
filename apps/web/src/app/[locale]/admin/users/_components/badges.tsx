import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import type { AccountStatus, AdminRole } from '@/lib/admin-users/roles'

const ROLE_STYLE: Record<AdminRole, string> = {
  ADMIN: 'border-blue-200 bg-blue-50 text-blue-700',
  EMPLOYER: 'border-violet-200 bg-violet-50 text-violet-700',
  AGENCY: 'border-amber-200 bg-amber-50 text-amber-700',
  CANDIDATE: 'border-sky-200 bg-sky-50 text-sky-700',
  FREELANCER: 'border-teal-200 bg-teal-50 text-teal-700',
}

/** Role badges for a user; shows a muted placeholder for an account without any role. */
export function RoleBadges({ roles }: { roles: AdminRole[] }) {
  const t = useTranslations('adminUsers')
  if (roles.length === 0) {
    return <span className="text-xs italic text-slate-400">{t('roles.none')}</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {roles.map((role) => (
        <Badge key={role} variant="outline" className={`text-xs ${ROLE_STYLE[role]}`}>
          {t(`roles.${role}`)}
        </Badge>
      ))}
    </div>
  )
}

const STATUS_STYLE: Record<AccountStatus, string> = {
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  LOCKED: 'border-amber-200 bg-amber-50 text-amber-700',
  SUSPENDED: 'border-red-200 bg-red-50 text-red-700',
}

export function StatusBadge({
  status,
  unverified = false,
}: {
  status: AccountStatus
  unverified?: boolean
}) {
  const t = useTranslations('adminUsers')
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant="outline" className={`text-xs ${STATUS_STYLE[status]}`}>
        {t(`status.${status}`)}
      </Badge>
      {unverified && (
        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-xs text-slate-600">
          {t('status.UNVERIFIED')}
        </Badge>
      )}
    </div>
  )
}
