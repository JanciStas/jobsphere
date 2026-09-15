'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Check, Plus, Trash2 } from 'lucide-react'

interface TaskRow {
  id: string
  title: string
  description: string | null
  dueDate: string | null
  status: string
  assignee: { id: string; name: string | null; email: string } | null
  application: { id: string; job: { title: string } | null } | null
}

type Filter = 'OPEN' | 'DONE' | 'ALL'

/**
 * Follow-ups.
 *
 * Deliberately plain: a title, an optional date, and a way to tick it off. The
 * point of the Task model was that "call her back on Thursday" had nowhere to
 * live, and the smallest thing that fixes that is a list — not a project
 * management tool nobody asked for.
 */
export function TasksClient({ locale }: { locale: string }) {
  const t = useTranslations('employer.tasks')
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [filter, setFilter] = useState<Filter>('OPEN')
  const [mineOnly, setMineOnly] = useState(true)
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (filter !== 'ALL') params.set('status', filter)
    if (mineOnly) params.set('mine', 'true')

    try {
      const res = await fetch(`/api/tasks?${params.toString()}`)
      if (!res.ok) throw new Error(t('loadFailed'))
      const data = await res.json()
      setTasks(data.tasks ?? [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadFailed'))
    }
  }, [filter, mineOnly, t])

  useEffect(() => {
    load()
  }, [load])

  const create = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!title.trim()) return

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          // The input is a date; the API wants a datetime. End of day, so a task
          // due today is not already overdue the moment it is written.
          ...(dueDate ? { dueDate: new Date(`${dueDate}T23:59:59`).toISOString() } : {}),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? t('createFailed'))
      }
      setTitle('')
      setDueDate('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('createFailed'))
    } finally {
      setLoading(false)
    }
  }

  const setStatus = async (id: string, status: 'OPEN' | 'DONE') => {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    await load()
  }

  const remove = async (id: string) => {
    if (!confirm(t('deleteConfirm'))) return
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
    await load()
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-6">
      <form onSubmit={create} className="flex flex-wrap items-end gap-2">
        <div className="min-w-[16rem] flex-1">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('taskPlaceholder')}
            aria-label={t('taskLabel')}
          />
        </div>
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          aria-label={t('dueDateLabel')}
          className="w-40"
        />
        <Button type="submit" disabled={loading || !title.trim()}>
          <Plus className="mr-2 h-4 w-4" />
          {loading ? t('adding') : t('add')}
        </Button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {(['OPEN', 'DONE', 'ALL'] as Filter[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full border px-3 py-1 text-xs ${
              filter === value ? 'bg-muted font-medium' : ''
            }`}
          >
            {value}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={mineOnly}
            onChange={(e) => setMineOnly(e.target.checked)}
          />
          {t('onlyMine')}
        </label>
      </div>

      {tasks.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t('empty')}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => {
            const overdue =
              task.status === 'OPEN' && task.dueDate && task.dueDate.slice(0, 10) < today
            return (
              <div
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p
                    className={`font-medium ${
                      task.status === 'DONE' ? 'text-muted-foreground line-through' : ''
                    }`}
                  >
                    {task.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {task.dueDate && (
                      <span className={overdue ? 'font-semibold text-red-600' : ''}>
                        {t('due', { date: task.dueDate.slice(0, 10) })}
                      </span>
                    )}
                    {task.assignee && <> · {task.assignee.name || task.assignee.email}</>}
                    {task.application?.job && (
                      <>
                        {' · '}
                        <Link
                          href={`/${locale}/employer/applicants/${task.application.id}`}
                          className="hover:underline"
                        >
                          {task.application.job.title}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatus(task.id, task.status === 'DONE' ? 'OPEN' : 'DONE')}
                  >
                    <Check className="mr-1 h-4 w-4" />
                    {task.status === 'DONE' ? t('reopen') : t('done')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(task.id)}>
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">{t('delete')}</span>
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
