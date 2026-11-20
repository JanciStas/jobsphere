import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => '1. 1. 2026' }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

import DashboardClient from '../dashboard-client'

const data = {
  user: { name: 'Jana', email: 'j@example.com' },
  stats: { total: 7, inProcess: 3, saved: 5, pending: 0, reviewing: 0, accepted: 0, rejected: 0 },
  profileCompletion: 50,
  profileSteps: { basicInfo: true, cvUploaded: true, skills: false, preferences: false },
  applications: [
    {
      id: 'a1',
      jobTitle: 'Frontend dev',
      company: 'Acme',
      status: 'INTERVIEW',
      appliedAt: '2026-01-01T00:00:00Z',
      location: 'Bratislava',
      jobId: 'j1',
    },
  ],
  recommendedJobs: [],
}

describe('candidate DashboardClient', () => {
  it('renders the four KPI values and the recent application', () => {
    render(<DashboardClient locale="sk" initialData={data} />)
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
    expect(screen.getByText('50 %')).toBeTruthy()
    expect(screen.getByText('Frontend dev')).toBeTruthy()
  })

  it('keeps the redirect notice and hides recommendations when there are none', () => {
    render(<DashboardClient locale="sk" initialData={data} notice={<p>NOTICE</p>} />)
    expect(screen.getByText('NOTICE')).toBeTruthy()
    expect(screen.queryByText('recommended')).toBeNull()
  })
})
