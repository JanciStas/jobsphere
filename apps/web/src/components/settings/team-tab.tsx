'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { Users, UserPlus, Loader2, MoreHorizontal, Trash2 } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { InviteMemberDialog } from './invite-member-dialog'
import { Badge } from '@/components/ui/badge'

interface TeamMember {
  userId: string
  orgId: string
  role: string
  createdAt: string
  user: {
    id: string
    name: string | null
    email: string
    avatar: string | null
  }
}

const ROLE_KEYS = ['ORG_ADMIN', 'RECRUITER', 'SUB_HR', 'HIRING_MANAGER', 'AGENCY']

const ROLE_COLORS = {
  ORG_ADMIN: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  RECRUITER: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  SUB_HR: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  HIRING_MANAGER: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  AGENCY: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
}

export function TeamTab() {
  const t = useTranslations('settingsTabs.team')
  const tRoles = useTranslations('settingsTabs.roles')
  const { data: session } = useSession()
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<TeamMember[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [memberToDelete, setMemberToDelete] = useState<TeamMember | null>(null)
  const [currentUserRole, setCurrentUserRole] = useState<string>('')

  // Fetch team members
  useEffect(() => {
    async function fetchMembers() {
      try {
        const response = await fetch('/api/organizations/current/members')
        if (!response.ok) throw new Error('Failed to fetch team members')

        const data = await response.json()
        setMembers(data.members || [])
        setCurrentUserRole(data.currentUserRole || '')
      } catch {
        toast.error(t('loadFailed'))
      } finally {
        setLoading(false)
      }
    }

    if (session?.user) {
      fetchMembers()
    }
  }, [session, toast])

  const handleRoleChange = async (member: TeamMember, newRole: string) => {
    try {
      const response = await fetch(`/api/organizations/current/members/${member.userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: newRole }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || t('roleUpdateFailed'))
      }

      // Update local state
      setMembers(members.map((m) => (m.userId === member.userId ? { ...m, role: newRole } : m)))

      toast.success(t('roleUpdated'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('roleUpdateFailed'))
    }
  }

  const handleDeleteMember = async () => {
    if (!memberToDelete) return

    try {
      const response = await fetch(`/api/organizations/current/members/${memberToDelete.userId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || t('removeFailed'))
      }

      // Update local state
      setMembers(members.filter((m) => m.userId !== memberToDelete.userId))

      toast.success(t('removed'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('removeFailed'))
    } finally {
      setMemberToDelete(null)
    }
  }

  const handleInviteSuccess = (newMember: TeamMember) => {
    setMembers([...members, newMember])
    setInviteDialogOpen(false)
  }

  // Filter members
  const filteredMembers = members.filter((member) => {
    const matchesSearch =
      member.user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      member.user.email.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesRole = roleFilter === 'all' || member.role === roleFilter
    return matchesSearch && matchesRole
  })

  const isAdmin = currentUserRole === 'ORG_ADMIN'

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
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                {t('title')}
              </CardTitle>
              <CardDescription>{t('description')}</CardDescription>
            </div>
            {isAdmin && (
              <Button onClick={() => setInviteDialogOpen(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                {t('invite')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="mb-6 flex items-center gap-4">
            <div className="flex-1">
              <Input
                placeholder={t('searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={t('filterByRole')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('allRoles')}</SelectItem>
                <SelectItem value="ORG_ADMIN">{tRoles('ORG_ADMIN')}</SelectItem>
                <SelectItem value="RECRUITER">{tRoles('RECRUITER')}</SelectItem>
                <SelectItem value="SUB_HR">{tRoles('SUB_HR')}</SelectItem>
                <SelectItem value="HIRING_MANAGER">{tRoles('HIRING_MANAGER')}</SelectItem>
                <SelectItem value="AGENCY">{tRoles('AGENCY')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Members Table */}
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colName')}</TableHead>
                  <TableHead>{t('colEmail')}</TableHead>
                  <TableHead>{t('colRole')}</TableHead>
                  <TableHead>{t('colJoined')}</TableHead>
                  {isAdmin && <TableHead className="text-right">{t('colActions')}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMembers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={isAdmin ? 5 : 4}
                      className="py-8 text-center text-muted-foreground"
                    >
                      {t('empty')}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMembers.map((member) => (
                    <TableRow key={member.userId}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          {member.user.avatar ? (
                            <img
                              src={member.user.avatar}
                              alt={member.user.name || t('user')}
                              className="h-8 w-8 rounded-full"
                            />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                              <span className="text-sm font-medium">
                                {(member.user.name || member.user.email)[0].toUpperCase()}
                              </span>
                            </div>
                          )}
                          <span>{member.user.name || t('noName')}</span>
                          {member.userId === session?.user?.id && (
                            <Badge variant="outline" className="text-xs">
                              {t('you')}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{member.user.email}</TableCell>
                      <TableCell>
                        {isAdmin && member.userId !== session?.user?.id ? (
                          <Select
                            value={member.role}
                            onValueChange={(value) => handleRoleChange(member, value)}
                          >
                            <SelectTrigger className="w-[150px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ORG_ADMIN">{tRoles('ORG_ADMIN')}</SelectItem>
                              <SelectItem value="RECRUITER">{tRoles('RECRUITER')}</SelectItem>
                              <SelectItem value="HIRING_MANAGER">
                                {tRoles('HIRING_MANAGER')}
                              </SelectItem>
                              <SelectItem value="AGENCY">{tRoles('AGENCY')}</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge
                            className={ROLE_COLORS[member.role as keyof typeof ROLE_COLORS] || ''}
                          >
                            {ROLE_KEYS.includes(member.role) ? tRoles(member.role) : member.role}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{new Date(member.createdAt).toLocaleDateString()}</TableCell>
                      {isAdmin && (
                        <TableCell className="text-right">
                          {member.userId !== session?.user?.id && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>{t('actions')}</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() => setMemberToDelete(member)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  {t('removeMember')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Stats */}
          <div className="mt-4 text-sm text-muted-foreground">
            {t('showing', { shown: filteredMembers.length, total: members.length })}
          </div>
        </CardContent>
      </Card>

      {/* Invite Dialog */}
      <InviteMemberDialog
        open={inviteDialogOpen}
        onOpenChange={setInviteDialogOpen}
        onSuccess={handleInviteSuccess}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!memberToDelete} onOpenChange={() => setMemberToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.rich('removeConfirm', {
                name: memberToDelete?.user.name || memberToDelete?.user.email || '',
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteMember}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
