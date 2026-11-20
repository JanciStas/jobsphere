import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { BillingActions } from '../billing-actions'

const base = {
  orgId: 'org-1',
  orgDeleted: false,
  hasLiveSubscription: true,
  stripeManaged: false,
  stripeUrl: null,
  features: [{ key: 'MAX_JOBS', limit: 5 }],
}

describe('BillingActions', () => {
  it('blocks every action for a deleted organization', () => {
    render(<BillingActions {...base} orgDeleted />)
    for (const k of ['actions.grant', 'actions.extend', 'actions.cancel', 'actions.limit']) {
      expect(screen.getByText(k).closest('button')).toBeDisabled()
    }
  })

  it('disables plan changes for Stripe-managed subscriptions and links to Stripe', () => {
    render(
      <BillingActions
        {...base}
        stripeManaged
        stripeUrl="https://dashboard.stripe.com/subscriptions/sub_1"
      />,
    )
    expect(screen.getByText('actions.grant').closest('button')).toBeDisabled()
    expect(screen.getByText('actions.openStripe').closest('a')).toHaveAttribute(
      'href',
      'https://dashboard.stripe.com/subscriptions/sub_1',
    )
  })

  it('confirm stays disabled until a reason and the confirmation are given', () => {
    render(<BillingActions {...base} />)
    fireEvent.click(screen.getByText('actions.cancel'))
    const confirm = screen.getByText('actions.confirm').closest('button')!
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('actions.reason'), {
      target: { value: 'Customer asked' },
    })
    expect(confirm).toBeDisabled()
    const cb = screen.getByLabelText('actions.confirmCheckbox') as HTMLInputElement
    act(() => cb.click())
    expect(confirm).not.toBeDisabled()
  })
})
