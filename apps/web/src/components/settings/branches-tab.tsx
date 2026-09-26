'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Building2, Plus, Loader2, Pencil, Trash2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { logger } from '@/lib/logger'

interface Branch {
  id: string
  name: string
  street: string | null
  city: string | null
  region: string | null
  country: string | null
  postalCode: string | null
  isPrimary: boolean
}

interface BranchForm {
  name: string
  street: string
  city: string
  region: string
  country: string
  postalCode: string
  isPrimary: boolean
}

const EMPTY_FORM: BranchForm = {
  name: '',
  street: '',
  city: '',
  region: '',
  country: '',
  postalCode: '',
  isPrimary: false,
}

function toForm(branch: Branch): BranchForm {
  return {
    name: branch.name,
    street: branch.street ?? '',
    city: branch.city ?? '',
    region: branch.region ?? '',
    country: branch.country ?? '',
    postalCode: branch.postalCode ?? '',
    isPrimary: branch.isPrimary,
  }
}

function formatAddress(branch: Branch): string {
  return [branch.street, branch.postalCode, branch.city, branch.region, branch.country]
    .filter(Boolean)
    .join(', ')
}

export function BranchesTab() {
  const t = useTranslations('settingsTabs.branches')
  const { data: session } = useSession()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<BranchForm>(EMPTY_FORM)
  const [branchToDelete, setBranchToDelete] = useState<Branch | null>(null)

  useEffect(() => {
    async function fetchBranches() {
      try {
        const res = await fetch('/api/organizations/current/branches')
        if (!res.ok) throw new Error('Failed to fetch branches')
        const data = await res.json()
        setBranches(data.branches || [])
      } catch (error) {
        logger.error('Error loading branches', error)
        toast.error(t('loadFailed'))
      } finally {
        setLoading(false)
      }
    }
    if (session?.user) fetchBranches()
  }, [session])

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (branch: Branch) => {
    setEditingId(branch.id)
    setForm(toForm(branch))
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error(t('nameRequired'))
      return
    }

    setSaving(true)
    try {
      const url = editingId
        ? `/api/organizations/current/branches/${editingId}`
        : '/api/organizations/current/branches'
      const method = editingId ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          street: form.street.trim() || null,
          city: form.city.trim() || null,
          region: form.region.trim() || null,
          country: form.country.trim() || null,
          postalCode: form.postalCode.trim() || null,
          isPrimary: form.isPrimary,
        }),
      })

      if (!res.ok) throw new Error('Failed to save branch')
      const data = await res.json()
      const saved: Branch = data.branch

      setBranches((prev) => {
        // Saving a primary branch demotes the others in the UI too.
        const next = prev.map((b) => (saved.isPrimary ? { ...b, isPrimary: false } : b))
        if (editingId) {
          return next.map((b) => (b.id === saved.id ? saved : b))
        }
        return [...next, saved]
      })

      toast.success(editingId ? t('updated') : t('added'))
      setDialogOpen(false)
    } catch (error) {
      logger.error('Error saving branch', error)
      toast.error(t('saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!branchToDelete) return
    try {
      const res = await fetch(`/api/organizations/current/branches/${branchToDelete.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete branch')
      setBranches((prev) => prev.filter((b) => b.id !== branchToDelete.id))
      toast.success(t('deleted'))
    } catch (error) {
      logger.error('Error deleting branch', error)
      toast.error(t('deleteFailed'))
    } finally {
      setBranchToDelete(null)
    }
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
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                {t('title')}
              </CardTitle>
              <CardDescription>{t('description')}</CardDescription>
            </div>
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              {t('add')}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {branches.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <Building2 className="mx-auto mb-3 h-12 w-12" />
              <p>{t('empty')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {branches.map((branch) => (
                <div
                  key={branch.id}
                  className="flex items-start justify-between gap-4 rounded-lg border p-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{branch.name}</p>
                      {branch.isPrimary && (
                        <Badge variant="secondary" className="text-xs">
                          {t('primary')}
                        </Badge>
                      )}
                    </div>
                    {formatAddress(branch) && (
                      <p className="mt-1 text-sm text-muted-foreground">{formatAddress(branch)}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(branch)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setBranchToDelete(branch)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? t('editTitle') : t('add')}</DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="branch-name">{t('name')}</Label>
              <Input
                id="branch-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t('namePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="branch-street">{t('street')}</Label>
              <Input
                id="branch-street"
                value={form.street}
                onChange={(e) => setForm({ ...form, street: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="branch-city">{t('city')}</Label>
                <Input
                  id="branch-city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-postal">{t('postalCode')}</Label>
                <Input
                  id="branch-postal"
                  value={form.postalCode}
                  onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="branch-region">{t('region')}</Label>
                <Input
                  id="branch-region"
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="branch-country">{t('country')}</Label>
                <Input
                  id="branch-country"
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="branch-primary"
                checked={form.isPrimary}
                onCheckedChange={(checked) => setForm({ ...form, isPrimary: checked === true })}
              />
              <Label htmlFor="branch-primary" className="cursor-pointer">
                {t('setPrimary')}
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!branchToDelete} onOpenChange={() => setBranchToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.rich('deleteConfirm', {
                name: branchToDelete?.name ?? '',
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
