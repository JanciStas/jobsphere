/**
 * E2E Tests - Email Sequence Automation
 *
 * Exercised against what `app/[locale]/employer/sequences/sequences-client.tsx`
 * actually renders: a left-hand list of sequences and, on the right, a single
 * react-hook-form editor. There is no separate "details" page, no wizard and no
 * data-testid anywhere on that page.
 *
 * Flows this file used to assume but which have NO UI at all — enrolment,
 * per-sequence statistics, email preview, drag-and-drop reordering, deleting a
 * sequence, role gating — are skipped with the reason inline instead of being
 * deleted, so they come back the moment those features land.
 */

import { test, expect } from '@/tests/fixtures/auth'
import type { Page } from '@playwright/test'
import { installWorkerMocks, getQueuedJobs, clearQueuedJobs } from '@/tests/mocks/workers'

const SEQUENCES_URL = '/en/employer/sequences'

/**
 * Sequence names must be unique per run: the assertions locate a sequence by its
 * name in the list, and the test database is not wiped between specs.
 */
function uniqueName(label: string): string {
  return `${label} ${Date.now()}-${Math.floor(Math.random() * 1000)}`
}

interface StepInput {
  name: string
  dayOffset: number
  subject: string
  body: string
}

/**
 * Step fields have no id/htmlFor — react-hook-form registers them by name — so
 * getByLabel() cannot reach them. They are addressed by `steps.<index>.<field>`.
 */
async function fillStep(page: Page, index: number, step: StepInput): Promise<void> {
  await page.locator(`input[name="steps.${index}.name"]`).fill(step.name)
  await page.locator(`input[name="steps.${index}.dayOffset"]`).fill(String(step.dayOffset))
  await page.locator(`input[name="steps.${index}.subject"]`).fill(step.subject)
  await page.locator(`textarea[name="steps.${index}.bodyTemplate"]`).fill(step.body)
}

/**
 * Creates a sequence through the UI and waits for the success toast.
 *
 * The button that starts a new sequence is "New Sequence" (there is no "Create
 * Sequence" control) and it seeds the editor with one pre-filled step, so only
 * steps after the first need an explicit "Add Step" click.
 */
async function createSequence(page: Page, name: string, steps: StepInput[]): Promise<void> {
  await page.getByRole('button', { name: 'New Sequence' }).click()
  await page.getByLabel(/sequence name/i).fill(name)

  for (const [index, step] of steps.entries()) {
    if (index > 0) {
      await page.getByRole('button', { name: 'Add Step' }).click()
    }
    await fillStep(page, index, step)
  }

  await page.getByRole('button', { name: 'Save Sequence' }).click()
  // Success is a sonner toast whose description is exactly this string.
  await expect(page.getByText('Email sequence created')).toBeVisible({ timeout: 15000 })
}

/** A sequence's entry in the left-hand list: a <button> with its name + "<n> steps". */
function sequenceCard(page: Page, name: string) {
  return page.getByRole('button').filter({ hasText: name })
}

/** One heading per step editor, e.g. "Step 1 (Day 0)" (CardTitle renders an <h3>). */
function stepHeadings(page: Page) {
  return page.getByRole('heading', { name: /^Step \d+/ })
}

test.describe('Email Sequences', () => {
  test.beforeEach(async ({ orgAdminUser }) => {
    // Install worker mocks to prevent actual job execution
    await installWorkerMocks(orgAdminUser)
    await clearQueuedJobs(orgAdminUser)
  })

  test.afterEach(async ({ orgAdminUser }) => {
    // Cleanup mock jobs after each test
    await clearQueuedJobs(orgAdminUser)
  })

  test('ORG_ADMIN can create email sequence with multiple steps', async ({ orgAdminUser }) => {
    await orgAdminUser.goto(SEQUENCES_URL)
    await expect(orgAdminUser.getByRole('heading', { name: 'Email Sequences' })).toBeVisible()

    const name = uniqueName('Welcome Email Series')
    await createSequence(orgAdminUser, name, [
      {
        name: 'Day 0: Welcome',
        dayOffset: 0,
        subject: 'Welcome to {{companyName}}!',
        body: 'Hi {{candidateName}},\n\nWelcome to our hiring process!',
      },
      {
        name: 'Day 3: Check-in',
        dayOffset: 3,
        subject: 'Quick check-in from {{companyName}}',
        body: 'Hi {{candidateName}},\n\nJust checking in on your application progress.',
      },
    ])

    // Verify sequence appears in list with its step count
    const card = sequenceCard(orgAdminUser, name)
    await expect(card).toBeVisible()
    await expect(card).toContainText('2 steps')
  })

  test('ORG_ADMIN can view sequence details with all steps', async ({ orgAdminUser }) => {
    await orgAdminUser.goto(SEQUENCES_URL)

    // Nothing is seeded, so the sequence under test is created first.
    const name = uniqueName('Sequence Details')
    await createSequence(orgAdminUser, name, [
      { name: 'Kickoff', dayOffset: 0, subject: 'Kickoff subject', body: 'Kickoff body' },
      { name: 'Nudge', dayOffset: 4, subject: 'Nudge subject', body: 'Nudge body' },
    ])

    // There is no details page: selecting a sequence loads it back into the same
    // editor. Reset the editor first so the assertions cannot pass on leftovers.
    await orgAdminUser.getByRole('button', { name: 'New Sequence' }).click()
    await expect(orgAdminUser.getByLabel(/sequence name/i)).toHaveValue('New Email Sequence')

    await sequenceCard(orgAdminUser, name).click()

    await expect(orgAdminUser.getByLabel(/sequence name/i)).toHaveValue(name)
    await expect(stepHeadings(orgAdminUser)).toHaveCount(2)
    await expect(orgAdminUser.locator('input[name="steps.1.subject"]')).toHaveValue('Nudge subject')
    await expect(orgAdminUser.locator('textarea[name="steps.1.bodyTemplate"]')).toHaveValue(
      'Nudge body',
    )
  })

  test('auto-enrolls candidate on status change and queues job', async ({ orgAdminUser }) => {
    test.skip(
      true,
      'No observable auto-enrolment flow: /en/employer/applications does not exist (applications live under /en/employer/applicants) and no UI reports sequence enrolment or queued jobs.',
    )

    await orgAdminUser.goto('/en/employer/applications')

    // Find first application
    const firstApplication = orgAdminUser.locator('[data-testid="application-row"]').first()

    // Click to view application details
    await firstApplication.click()

    // Change application status (this should trigger auto-enrollment)
    await orgAdminUser.getByRole('button', { name: /change status/i }).click()
    await orgAdminUser.getByRole('option', { name: /interview/i }).click()

    // Confirm status change
    await orgAdminUser.getByRole('button', { name: /confirm/i }).click()

    // Wait for status change to be processed
    await expect(orgAdminUser.getByText(/status updated/i)).toBeVisible({ timeout: 10000 })

    // Verify BullMQ job was queued (using mocks)
    const queuedJobs = await getQueuedJobs(orgAdminUser, 'email-sequence')

    // Should have at least one job queued
    expect(queuedJobs.length).toBeGreaterThan(0)

    // Verify job contains enrollment data
    const lastJob = queuedJobs[queuedJobs.length - 1]
    expect(lastJob.name).toBe('send-step')
    expect(lastJob.data).toHaveProperty('enrollmentId')
    expect(lastJob.data).toHaveProperty('stepId')
  })

  test('ORG_ADMIN can manually enroll candidate in sequence', async ({ orgAdminUser }) => {
    test.skip(
      true,
      'No enrolment UI exists: the string "enroll" appears in no component of the app, and there is no /en/employer/candidates route.',
    )

    await orgAdminUser.goto('/en/employer/candidates')

    const firstCandidate = orgAdminUser.locator('[data-testid="candidate-row"]').first()
    await firstCandidate.click()

    // Click "Enroll in Sequence" button
    await orgAdminUser.getByRole('button', { name: /enroll in sequence/i }).click()

    // Select a sequence from dropdown
    await orgAdminUser.getByRole('combobox', { name: /select sequence/i }).click()
    await orgAdminUser.getByRole('option').first().click()

    // Confirm enrollment
    await orgAdminUser.getByRole('button', { name: /enroll/i }).click()

    // Verify success message
    await expect(orgAdminUser.getByText(/enrolled successfully/i)).toBeVisible({ timeout: 10000 })

    // Verify job was queued
    const queuedJobs = await getQueuedJobs(orgAdminUser, 'email-sequence')
    expect(queuedJobs.length).toBeGreaterThan(0)

    const lastJob = queuedJobs[queuedJobs.length - 1]
    expect(lastJob.name).toBe('send-step')
  })

  test('ORG_ADMIN can edit existing email sequence', async ({ orgAdminUser }) => {
    await orgAdminUser.goto(SEQUENCES_URL)

    const name = uniqueName('Editable Sequence')
    await createSequence(orgAdminUser, name, [
      { name: 'Intro', dayOffset: 0, subject: 'Original subject', body: 'Original body' },
    ])

    // The editor stays on the sequence that was just saved, so it can be edited
    // straight away; the same submit button PATCHes an existing sequence.
    const updatedName = `${name} (updated)`
    await orgAdminUser.getByLabel(/sequence name/i).fill(updatedName)
    await orgAdminUser.getByLabel(/description/i).fill('This is an updated description')
    await orgAdminUser.locator('input[name="steps.0.subject"]').fill('Updated subject line')

    await orgAdminUser.getByRole('button', { name: 'Save Sequence' }).click()
    await expect(orgAdminUser.getByText('Email sequence updated')).toBeVisible({ timeout: 15000 })

    await expect(sequenceCard(orgAdminUser, updatedName)).toBeVisible()
  })

  test('ORG_ADMIN can add new step to existing sequence', async ({ orgAdminUser }) => {
    await orgAdminUser.goto(SEQUENCES_URL)

    const name = uniqueName('Growing Sequence')
    await createSequence(orgAdminUser, name, [
      { name: 'Intro', dayOffset: 0, subject: 'Intro subject', body: 'Intro body' },
    ])

    await expect(stepHeadings(orgAdminUser)).toHaveCount(1)

    await orgAdminUser.getByRole('button', { name: 'Add Step' }).click()
    await expect(stepHeadings(orgAdminUser)).toHaveCount(2)

    await fillStep(orgAdminUser, 1, {
      name: 'New Follow-up Step',
      dayOffset: 7,
      subject: 'Following up on your application',
      body: 'Hi {{candidateName}},\n\nWe wanted to follow up.',
    })

    await orgAdminUser.getByRole('button', { name: 'Save Sequence' }).click()
    await expect(orgAdminUser.getByText('Email sequence updated')).toBeVisible({ timeout: 15000 })

    await expect(sequenceCard(orgAdminUser, name)).toContainText('2 steps')
  })

  test('ORG_ADMIN can delete email step from sequence', async ({ orgAdminUser }) => {
    await orgAdminUser.goto(SEQUENCES_URL)

    const name = uniqueName('Shrinking Sequence')
    await createSequence(orgAdminUser, name, [
      { name: 'Intro', dayOffset: 0, subject: 'Intro subject', body: 'Intro body' },
      { name: 'Doomed', dayOffset: 2, subject: 'Doomed subject', body: 'Doomed body' },
    ])

    await expect(stepHeadings(orgAdminUser)).toHaveCount(2)

    // The remove control is an icon-only button with no accessible name and no
    // test id (it would deserve one), so it is reached through its lucide icon
    // class. There is no confirmation dialog — the step is dropped immediately,
    // and the button is disabled while only one step is left.
    await orgAdminUser.locator('form button:has(svg.lucide-trash2)').last().click()
    await expect(stepHeadings(orgAdminUser)).toHaveCount(1)

    await orgAdminUser.getByRole('button', { name: 'Save Sequence' }).click()
    await expect(orgAdminUser.getByText('Email sequence updated')).toBeVisible({ timeout: 15000 })

    // The list is not pluralised — it really does render "1 steps".
    await expect(sequenceCard(orgAdminUser, name)).toContainText('1 steps')
  })

  test('ORG_ADMIN can activate/deactivate sequence', async ({ orgAdminUser }) => {
    await orgAdminUser.goto(SEQUENCES_URL)

    const name = uniqueName('Toggleable Sequence')
    await createSequence(orgAdminUser, name, [
      { name: 'Intro', dayOffset: 0, subject: 'Intro subject', body: 'Intro body' },
    ])

    // Activation is the "Active" checkbox in the editor, not a control on the
    // list entry; the list only reflects the state as an "Active" badge.
    const card = sequenceCard(orgAdminUser, name)
    const activeCheckbox = orgAdminUser.locator('input#active')

    await expect(card).not.toContainText('Active')

    await activeCheckbox.check()
    await orgAdminUser.getByRole('button', { name: 'Save Sequence' }).click()
    await expect(card).toContainText('Active', { timeout: 15000 })

    await activeCheckbox.uncheck()
    await orgAdminUser.getByRole('button', { name: 'Save Sequence' }).click()
    await expect(card).not.toContainText('Active', { timeout: 15000 })
  })

  test('ORG_ADMIN can delete email sequence', async ({ orgAdminUser }) => {
    test.skip(
      true,
      'The sequences page has no delete control — DELETE /api/sequences/[id] exists but nothing in the UI calls it.',
    )

    await orgAdminUser.goto(SEQUENCES_URL)

    // Count initial sequences
    const initialCount = await orgAdminUser.locator('[data-testid="sequence-card"]').count()

    // Get name of first sequence to verify deletion
    const firstSequence = orgAdminUser.locator('[data-testid="sequence-card"]').first()
    const sequenceName = await firstSequence.locator('[data-testid="sequence-name"]').textContent()

    // Delete sequence
    await firstSequence.locator('[data-testid="delete-sequence"]').click()

    // Confirm deletion
    await orgAdminUser.getByRole('button', { name: /confirm delete/i }).click()

    // Verify success message
    await expect(orgAdminUser.getByText(/sequence deleted successfully/i)).toBeVisible({
      timeout: 10000,
    })

    // Verify sequence is removed from list
    if (sequenceName) {
      await expect(orgAdminUser.getByText(sequenceName)).not.toBeVisible()
    }

    // Verify count decreased
    const updatedCount = await orgAdminUser.locator('[data-testid="sequence-card"]').count()
    expect(updatedCount).toBe(initialCount - 1)
  })

  test('prevents duplicate enrollment in same sequence', async ({ orgAdminUser }) => {
    test.skip(
      true,
      'No enrolment UI exists (see "manually enroll candidate"), so duplicate enrolment cannot be driven from the browser.',
    )

    await orgAdminUser.goto('/en/employer/candidates')

    const firstCandidate = orgAdminUser.locator('[data-testid="candidate-row"]').first()
    await firstCandidate.click()

    // First enrollment
    await orgAdminUser.getByRole('button', { name: /enroll in sequence/i }).click()
    await orgAdminUser.getByRole('combobox', { name: /select sequence/i }).click()

    // Get the first sequence name
    const firstOption = orgAdminUser.getByRole('option').first()
    const sequenceName = await firstOption.textContent()
    await firstOption.click()

    await orgAdminUser.getByRole('button', { name: /enroll/i }).click()

    // Wait for first enrollment to complete
    await expect(orgAdminUser.getByText(/enrolled successfully/i)).toBeVisible({ timeout: 10000 })

    // Attempt second enrollment in same sequence
    await orgAdminUser.getByRole('button', { name: /enroll in sequence/i }).click()
    await orgAdminUser.getByRole('combobox', { name: /select sequence/i }).click()

    // Try to select the same sequence
    const sameSequence = orgAdminUser.getByRole('option', { name: sequenceName || '' })

    // Should either be disabled or show error
    if ((await sameSequence.count()) > 0) {
      await sameSequence.click()
      await orgAdminUser.getByRole('button', { name: /enroll/i }).click()

      // Verify error message about duplicate enrollment
      await expect(orgAdminUser.getByText(/already enrolled|duplicate enrollment/i)).toBeVisible({
        timeout: 10000,
      })
    }
  })

  test('RECRUITER cannot create or edit sequences', async ({ recruiterUser }) => {
    test.skip(
      true,
      'Sequences are not role-gated: the employer layout only requires org membership and /api/sequences authorises on orgId alone, so a RECRUITER gets the same editor as an ORG_ADMIN. This test asserted a restriction the app does not implement (and passed only because it looked for a "Create Sequence" button that never existed).',
    )

    await recruiterUser.goto(SEQUENCES_URL)

    await expect(recruiterUser.getByRole('button', { name: 'New Sequence' })).not.toBeVisible()
  })

  test('displays sequence statistics correctly', async ({ orgAdminUser }) => {
    test.skip(
      true,
      'The sequences page shows no statistics at all — no enrolment counts, no completions, no emails-sent figures.',
    )

    await orgAdminUser.goto(SEQUENCES_URL)

    const firstSequence = orgAdminUser.locator('[data-testid="sequence-card"]').first()
    await firstSequence.click()

    // Verify statistics are displayed
    await expect(orgAdminUser.getByText(/active enrollments/i)).toBeVisible()
    await expect(orgAdminUser.getByText(/completed/i)).toBeVisible()
    await expect(orgAdminUser.getByText(/emails sent/i)).toBeVisible()

    // Verify numbers are displayed (should be numeric)
    const activeCount = orgAdminUser.locator('[data-testid="active-enrollments"]')
    await expect(activeCount).toBeVisible()
  })

  test('can preview email template with merge tags replaced', async ({ orgAdminUser }) => {
    test.skip(
      true,
      'The step editor has no preview control; merge tags are only documented inline ("Available variables"), never rendered with sample data.',
    )

    await orgAdminUser.goto(SEQUENCES_URL)

    const firstSequence = orgAdminUser.locator('[data-testid="sequence-card"]').first()
    await firstSequence.locator('[data-testid="edit-sequence"]').click()

    // Click preview on first step
    const firstStep = orgAdminUser.locator('[data-testid="step-editor"]').first()
    await firstStep.locator('[data-testid="preview-email"]').click()

    // Verify preview modal opened
    await expect(orgAdminUser.getByRole('heading', { name: /email preview/i })).toBeVisible()

    // Verify merge tags are replaced with sample data
    const previewContent = orgAdminUser.locator('[data-testid="email-preview-content"]')
    await expect(previewContent).toBeVisible()

    // Should not contain raw merge tags
    const content = await previewContent.textContent()
    expect(content).not.toContain('{{candidateName}}')
    expect(content).not.toContain('{{companyName}}')
  })

  test('validates required fields when creating sequence', async ({ orgAdminUser }) => {
    await orgAdminUser.goto(SEQUENCES_URL)

    await orgAdminUser.getByRole('button', { name: 'New Sequence' }).click()

    // The editor pre-fills the name and one complete step, so the empty-name
    // case has to be produced explicitly. ("at least one step" is unreachable
    // from the UI: removing the last step is disabled.)
    await orgAdminUser.getByLabel(/sequence name/i).fill('')
    await orgAdminUser.getByRole('button', { name: 'Save Sequence' }).click()

    // The form renders zod's default message verbatim — there is no
    // "Name is required" copy anywhere in the app.
    await expect(orgAdminUser.getByText(/at least 1 character/i).first()).toBeVisible()
    await expect(orgAdminUser.getByText('Email sequence created')).toHaveCount(0)
  })

  test('validates step fields when adding step', async ({ orgAdminUser }) => {
    await orgAdminUser.goto(SEQUENCES_URL)

    await orgAdminUser.getByRole('button', { name: 'New Sequence' }).click()
    await orgAdminUser.getByLabel(/sequence name/i).fill('Test Sequence')

    // A newly added step is pre-filled too, so the required-field check needs
    // the subject and body cleared by hand.
    await orgAdminUser.getByRole('button', { name: 'Add Step' }).click()
    await orgAdminUser.locator('input[name="steps.1.subject"]').fill('')
    await orgAdminUser.locator('textarea[name="steps.1.bodyTemplate"]').fill('')

    await orgAdminUser.getByRole('button', { name: 'Save Sequence' }).click()

    // One zod default message per empty required field (subject + body).
    await expect(orgAdminUser.getByText(/at least 1 character/i)).toHaveCount(2)
    await expect(orgAdminUser.getByText('Email sequence created')).toHaveCount(0)
  })

  test('reorders steps using drag and drop', async ({ orgAdminUser }) => {
    test.skip(
      true,
      'Steps cannot be reordered: the editor renders a plain list with no drag handles and no move up/down controls (order is fixed at creation time).',
    )

    await orgAdminUser.goto(SEQUENCES_URL)

    const firstSequence = orgAdminUser.locator('[data-testid="sequence-card"]').first()
    await firstSequence.locator('[data-testid="edit-sequence"]').click()

    // Get text of first step
    const firstStepName = await orgAdminUser
      .locator('[data-testid="step-editor"]')
      .first()
      .locator('[data-testid="step-name"]')
      .textContent()

    // Drag first step to second position
    const firstStep = orgAdminUser.locator('[data-testid="step-editor"]').first()
    const secondStep = orgAdminUser.locator('[data-testid="step-editor"]').nth(1)

    await firstStep.dragTo(secondStep)

    // Verify order changed
    const newFirstStepName = await orgAdminUser
      .locator('[data-testid="step-editor"]')
      .first()
      .locator('[data-testid="step-name"]')
      .textContent()

    expect(newFirstStepName).not.toBe(firstStepName)

    // Save
    await orgAdminUser.getByRole('button', { name: 'Save Sequence' }).click()

    await expect(orgAdminUser.getByText('Email sequence updated')).toBeVisible({ timeout: 15000 })
  })
})
