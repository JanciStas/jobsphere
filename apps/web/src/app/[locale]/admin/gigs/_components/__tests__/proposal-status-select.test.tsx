import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { ProposalStatusSelect } from '../proposal-status-select'

beforeEach(() => {
  vi.restoreAllMocks()
  refresh.mockClear()
})

describe('ProposalStatusSelect', () => {
  it('disables ACCEPTED when another proposal is already accepted', () => {
    render(
      <ProposalStatusSelect gigId="g1" proposalId="p1" currentStatus="PENDING" otherAccepted />,
    )
    const option = screen.getByRole('option', { name: 'proposalStatusLabels.ACCEPTED' })
    expect((option as HTMLOptionElement).disabled).toBe(true)
  })

  it('PATCHes the new status and refreshes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ProposalStatusSelect
        gigId="g1"
        proposalId="p1"
        currentStatus="PENDING"
        otherAccepted={false}
      />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'REJECTED' } })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/gigs/g1/proposals/p1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'REJECTED' }) }),
    )
  })

  it('shows the API error (e.g. 409 conflict) instead of refreshing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Already accepted' }) }),
    )
    render(
      <ProposalStatusSelect
        gigId="g1"
        proposalId="p1"
        currentStatus="PENDING"
        otherAccepted={false}
      />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ACCEPTED' } })
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Already accepted')
    expect(refresh).not.toHaveBeenCalled()
  })
})
