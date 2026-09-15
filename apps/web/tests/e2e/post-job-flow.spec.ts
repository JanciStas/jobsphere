/**
 * E2E Test - Post Job Flow
 *
 * Tests the public `/[locale]/post-job` form (a different, simpler surface than
 * `/employer/jobs/new`).
 *
 * Two facts about this form drive the selectors below:
 *  - its inputs are controlled React state with `id=` but NO `name=` attribute,
 *    so `[name=jobTitle]` matches nothing — go through the labels instead;
 *  - "Publish Job" has no HTML5 `required` validation. The button is simply
 *    `disabled` until both the job title and the description have a value.
 */

import { test, expect } from '../fixtures/auth'

test.describe('Post Job Flow', () => {
  test('recruiter can post a new job successfully', async ({ recruiterUser }) => {
    // Navigate to post-job page
    await recruiterUser.goto('/en/post-job')

    // Verify we're on the correct page
    await expect(recruiterUser).toHaveURL(/\/en\/post-job/)

    // Wait for page to load completely
    await expect(recruiterUser.locator('h1')).toContainText('Post')

    // Fill in basic job information. A unique title keeps the detail-page
    // assertion below unambiguous against the seeded "Senior React Developer".
    await recruiterUser.getByLabel(/job title/i).fill('E2E Post Job Flow Engineer')
    await recruiterUser.getByLabel('Company', { exact: true }).fill('Test Corp E2E')
    await recruiterUser.getByLabel('Location', { exact: true }).fill('Prague, Czech Republic')

    // Work mode and employment type are plain <select>s wired to their labels.
    await recruiterUser.getByLabel('Remote', { exact: true }).selectOption('hybrid')
    await recruiterUser.getByLabel(/employment type/i).selectOption('fullTime')

    // Fill in job description (the API rejects anything under 50 characters).
    await recruiterUser
      .getByLabel('Description', { exact: true })
      .fill(
        'We are looking for an experienced React developer to join our team. ' +
          'The ideal candidate will have strong TypeScript skills and experience with Next.js.',
      )

    // Fill in responsibilities
    await recruiterUser
      .getByLabel(/responsibilities/i)
      .fill(
        '- Develop and maintain React applications\n' +
          '- Write clean, testable code\n' +
          '- Collaborate with the team',
      )

    // Fill in requirements
    await recruiterUser
      .getByLabel(/requirements/i)
      .fill(
        '- 5+ years of React experience\n' +
          '- Strong TypeScript skills\n' +
          '- Experience with Next.js',
      )

    // The salary inputs have neither id nor name — only placeholders "Min"/"Max".
    await recruiterUser.getByPlaceholder('Min', { exact: true }).fill('80000')
    await recruiterUser.getByPlaceholder('Max', { exact: true }).fill('120000')

    // Currency is an unlabelled <select>; it is the only one offering USD.
    await recruiterUser.locator('select:has(option[value="USD"])').selectOption('EUR')

    // Fill in application email
    await recruiterUser.getByLabel(/application email/i).fill('jobs@testcorp.com')

    // Submit the form
    await recruiterUser.getByRole('button', { name: /publish job/i }).click()

    // Wait for navigation after successful submission
    // Should redirect to job detail page with job ID in URL
    await expect(recruiterUser).toHaveURL(/\/jobs\/[a-zA-Z0-9_-]+/, { timeout: 10000 })

    // The job detail page has no <h1> — the title renders as a CardTitle (h3).
    await expect(
      recruiterUser.getByRole('heading', { name: 'E2E Post Job Flow Engineer' }).first(),
    ).toBeVisible({ timeout: 5000 })

    // Verify job details are displayed. NOTE: the company typed above is NOT
    // asserted — `/api/jobs` ignores the form's `company` field entirely and
    // always attributes the posting to the caller's own organization.
    await expect(recruiterUser.getByText('Prague, Czech Republic').first()).toBeVisible()
    await expect(recruiterUser.getByText('Test Org Inc').first()).toBeVisible()
  })

  test('post-job form keeps Publish disabled until the required fields are filled', async ({
    recruiterUser,
  }) => {
    await recruiterUser.goto('/en/post-job')

    // No HTML5 validation exists here: the CTA is gated on state instead.
    const publishButton = recruiterUser.getByRole('button', { name: /publish job/i })
    await expect(publishButton).toBeDisabled()

    // A title alone is not enough — the description gates it too.
    await recruiterUser.getByLabel(/job title/i).fill('Gated Job Title')
    await expect(publishButton).toBeDisabled()

    await recruiterUser
      .getByLabel('Description', { exact: true })
      .fill('A description long enough to satisfy the client-side gate.')
    await expect(publishButton).toBeEnabled()

    // Nothing was submitted, so we are still on the form.
    await expect(recruiterUser).toHaveURL(/\/en\/post-job/)
  })

  test('recruiter can save draft (placeholder test)', async ({ recruiterUser }) => {
    await recruiterUser.goto('/en/post-job')

    // Fill in minimal information
    await recruiterUser.getByLabel(/job title/i).fill('Draft Job Title')
    await recruiterUser.getByLabel('Description', { exact: true }).fill('Draft description')

    // Click save draft button — its label is "Save as Draft", not "Save Draft".
    await recruiterUser.getByRole('button', { name: /save as draft/i }).click()

    // Should see success toast notification. Note: the handler only fires a
    // toast — nothing is persisted, not even to localStorage.
    await expect(recruiterUser.getByText(/draft saved/i).first()).toBeVisible({ timeout: 3000 })
  })

  test('post-job form handles API errors gracefully', async ({ recruiterUser }) => {
    await recruiterUser.goto('/en/post-job')

    // Fill in the two fields that gate the Publish button, but keep the
    // description under the API's 50-character minimum so POST /api/jobs
    // answers 400 { error: 'Validation failed' }.
    await recruiterUser.getByLabel(/job title/i).fill('Test Job')
    await recruiterUser.getByLabel('Company', { exact: true }).fill('Test Company')
    await recruiterUser.getByLabel('Location', { exact: true }).fill('Test Location')
    await recruiterUser
      .getByLabel('Description', { exact: true })
      .fill('Test description for the job posting')

    // Submit the form
    await recruiterUser.getByRole('button', { name: /publish job/i }).click()

    // The error is surfaced inline under the actions card (and as a toast),
    // and the user stays on the form.
    await expect(recruiterUser.getByText(/validation failed/i).first()).toBeVisible({
      timeout: 10000,
    })
    await expect(recruiterUser).toHaveURL(/\/en\/post-job/)
  })

  test('post-job form pre-fills company name for existing organization', async ({
    recruiterUser,
  }) => {
    test.skip(
      true,
      'No company pre-fill exists: the post-job form never reads the user organization, and /api/jobs discards the company field',
    )
    await recruiterUser.goto('/en/post-job')
  })
})
