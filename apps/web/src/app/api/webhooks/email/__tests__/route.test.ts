import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/rate-limit', () => ({ withRateLimit: (h: unknown) => h }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    emailSequenceEvent: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/prisma'
import { POST } from '../route'

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/webhooks/email', {
      method: 'POST',
      body: JSON.stringify(body),
    }) as never,
  )

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.RESEND_WEBHOOK_SECRET
  delete process.env.SENDGRID_WEBHOOK_SECRET
})

describe('SendGrid webhook batching', () => {
  it('uses one lookup and one bulk insert for a whole batch of events', async () => {
    asMock(prisma.emailSequenceEvent.findMany).mockResolvedValue([
      { runId: 'run1', stepId: 'stepA' },
      { runId: 'run2', stepId: 'stepB' },
    ])

    const res = await post([
      { event: 'open', emailId: 'run1' },
      { event: 'click', emailId: 'run1' },
      { event: 'open', 'X-Email-ID': 'run2' },
      { event: 'open', emailId: 'unknown-run' },
      { event: 'open' },
    ])

    expect(res.status).toBe(200)
    expect(prisma.emailSequenceEvent.findMany).toHaveBeenCalledTimes(1)
    expect(
      asMock(prisma.emailSequenceEvent.findMany).mock.calls[0][0].where.runId.in.sort(),
    ).toEqual(['run1', 'run2', 'unknown-run'])
    expect(prisma.emailSequenceEvent.createMany).toHaveBeenCalledTimes(1)
    const data = asMock(prisma.emailSequenceEvent.createMany).mock.calls[0][0].data
    expect(
      data.map((d: { runId: string; kind: string; stepId: string }) => [d.runId, d.kind, d.stepId]),
    ).toEqual([
      ['run1', 'OPEN', 'stepA'],
      ['run1', 'CLICK', 'stepA'],
      ['run2', 'OPEN', 'stepB'],
    ])
    expect(prisma.emailSequenceEvent.create).not.toHaveBeenCalled()
  })

  it('does nothing when no event carries a run id and kind', async () => {
    const res = await post([{ event: 'open' }, { emailId: 'run1' }])

    expect(res.status).toBe(200)
    expect(prisma.emailSequenceEvent.findMany).not.toHaveBeenCalled()
    expect(prisma.emailSequenceEvent.createMany).not.toHaveBeenCalled()
  })
})

describe('Resend webhook', () => {
  it('appends an event for a run that already has events, without a separate run lookup', async () => {
    asMock(prisma.emailSequenceEvent.findFirst).mockResolvedValue({ stepId: 'stepA' })

    const res = await post({ type: 'email.opened', data: { tags: { emailId: 'run1' } } })

    expect(res.status).toBe(200)
    expect(asMock(prisma.emailSequenceEvent.create).mock.calls[0][0].data).toMatchObject({
      runId: 'run1',
      stepId: 'stepA',
      kind: 'OPENED',
    })
  })

  it('ignores events for runs without history', async () => {
    asMock(prisma.emailSequenceEvent.findFirst).mockResolvedValue(null)

    await post({ type: 'email.opened', data: { tags: { emailId: 'ghost' } } })

    expect(prisma.emailSequenceEvent.create).not.toHaveBeenCalled()
  })
})
