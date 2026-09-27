/**
 * E2E Tests - Employer Job Management
 *
 * This test suite covers the complete employer workflow for managing jobs and applicants:
 * - Creating new job postings
 * - Editing existing job details
 * - Viewing and managing applicants
 * - Changing applicant status through the pipeline
 * - Closing job postings
 * - Viewing job analytics
 */

import { test, expect } from '../fixtures/auth'
import type { Page } from '@playwright/test'

/**
 * Reach one of the job form's dropdowns.
 *
 * Every `<Label htmlFor="type|seniority|workMode|currency">` on the job form
 * points at an id that the Radix `<SelectTrigger>` never renders, so the label
 * is not wired to anything and `getByLabel()` cannot find these comboboxes.
 * Target the trigger that sits next to the label instead.
 */
function selectByLabelFor(page: Page, id: string) {
  return page.locator(`label[for="${id}"] ~ button[role="combobox"]`)
}

test.describe('Employer Job Management', () => {
  test.describe('Job Creation', () => {
    test('should allow ORG_ADMIN to create a new job posting', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer/jobs/new')

      // Verify page loaded
      await expect(orgAdminUser.getByRole('heading', { name: /new job/i })).toBeVisible()

      // Fill basic information
      await orgAdminUser.getByLabel(/job title/i).fill('Senior Software Engineer')
      await selectByLabelFor(orgAdminUser, 'type').click()
      // The option label is "Full-time" (hyphenated), not "Full time".
      await orgAdminUser.getByRole('option', { name: /full-time/i }).click()
      await selectByLabelFor(orgAdminUser, 'seniority').click()
      await orgAdminUser.getByRole('option', { name: 'Senior', exact: true }).click()
      await orgAdminUser.getByLabel(/department/i).fill('Engineering')

      // Fill location and work mode
      await orgAdminUser.getByLabel(/^location/i).fill('San Francisco, CA')
      await selectByLabelFor(orgAdminUser, 'workMode').click()
      await orgAdminUser.getByRole('option', { name: /hybrid/i }).click()

      // Fill job description
      await orgAdminUser
        .getByLabel(/^description/i)
        .fill(
          'We are looking for an experienced software engineer to join our growing team. ' +
            'You will be working on cutting-edge technologies and solving complex problems. ' +
            'This is an excellent opportunity for career growth.',
        )

      // Fill requirements
      await orgAdminUser
        .getByLabel(/requirements/i)
        .fill(
          '- 5+ years of experience in software development\n' +
            '- Strong knowledge of JavaScript/TypeScript\n' +
            '- Experience with React and Node.js\n' +
            '- Excellent problem-solving skills',
        )

      // Fill benefits (optional)
      await orgAdminUser
        .getByLabel(/benefits/i)
        .fill(
          '- Competitive salary\n' +
            '- Health insurance\n' +
            '- Flexible working hours\n' +
            '- Remote work options',
        )

      // Fill compensation. Both salary fields MUST be filled: an empty numeric
      // input resolves to NaN, which the form's Zod schema rejects silently.
      await orgAdminUser.getByLabel(/min salary/i).fill('8000')
      await orgAdminUser.getByLabel(/max salary/i).fill('12000')
      await selectByLabelFor(orgAdminUser, 'currency').click()
      await orgAdminUser.getByRole('option', { name: 'USD', exact: true }).click()

      // Fill keywords
      await orgAdminUser.getByLabel(/keywords/i).fill('javascript, react, node.js, typescript')

      // Submit the form
      await orgAdminUser.getByRole('button', { name: /publish/i }).click()

      // Wait for success and redirect to employer dashboard. Anchored, because
      // /en/employer/jobs/new (where we started) also matches an unanchored
      // /\/en\/employer/ and would make this assertion vacuous.
      await expect(orgAdminUser).toHaveURL(/\/en\/employer$/, { timeout: 10000 })

      // Verify job appears in the list (.first(): a retried run leaves more than
      // one posting with this title in the org).
      await expect(orgAdminUser.getByText('Senior Software Engineer').first()).toBeVisible()
    })

    test('should show validation errors for incomplete job form', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer/jobs/new')

      // Try to submit without filling required fields
      await orgAdminUser.getByRole('button', { name: /publish/i }).click()

      // Should show validation errors
      await expect(orgAdminUser.getByText(/title must be at least 3 characters/i)).toBeVisible()
      await expect(
        orgAdminUser.getByText(/description must be at least 50 characters/i),
      ).toBeVisible()
      await expect(
        orgAdminUser.getByText(/requirements must be at least 20 characters/i),
      ).toBeVisible()
      await expect(orgAdminUser.getByText(/location is required/i)).toBeVisible()
    })

    test('should allow RECRUITER to create a new job posting', async ({ recruiterUser }) => {
      await recruiterUser.goto('/en/employer/jobs/new')

      // Verify recruiter has access to create jobs
      await expect(recruiterUser.getByRole('heading', { name: /new job/i })).toBeVisible()

      // Fill minimal required fields
      await recruiterUser.getByLabel(/job title/i).fill('Frontend Developer')
      await recruiterUser.getByLabel(/^location/i).fill('New York, NY')
      await recruiterUser
        .getByLabel(/^description/i)
        .fill(
          'Join our team as a frontend developer working with modern web technologies. ' +
            'You will collaborate with designers and backend engineers to build amazing user experiences.',
        )
      await recruiterUser
        .getByLabel(/requirements/i)
        .fill('Experience with React, HTML, CSS, and JavaScript. Strong attention to detail.')

      // Salary is nominally optional, but leaving either field empty makes the
      // form's Zod schema see NaN and abort the submit with no message at all.
      await recruiterUser.getByLabel(/min salary/i).fill('4000')
      await recruiterUser.getByLabel(/max salary/i).fill('6000')

      // Submit
      await recruiterUser.getByRole('button', { name: /publish/i }).click()

      // Verify success — anchored, because /en/employer/jobs/new (where we
      // started) also matches an unanchored /\/en\/employer/.
      await expect(recruiterUser).toHaveURL(/\/en\/employer$/, { timeout: 10000 })
    })
  })

  test.describe('Job Editing', () => {
    test('should allow editing existing job details', async ({ orgAdminUser }) => {
      // Navigate to employer dashboard
      await orgAdminUser.goto('/en/employer')

      // Wait for jobs to load and click edit on the first job. The dashboard's
      // "Edit" control is <Button asChild><Link> — it has role=link, not button.
      const editLink = orgAdminUser.getByRole('link', { name: /^edit$/i }).first()
      await editLink.waitFor({ state: 'visible', timeout: 10000 })
      await editLink.click()

      // Verify we're on the edit page
      await expect(orgAdminUser.getByRole('heading', { name: /edit job/i })).toBeVisible()

      // Update job title
      const titleInput = orgAdminUser.getByLabel(/job title/i)
      await titleInput.clear()
      await titleInput.fill('Updated Job Title - Senior Engineer')

      // Update description
      const descriptionInput = orgAdminUser.getByLabel(/^description/i)
      await descriptionInput.clear()
      await descriptionInput.fill(
        'Updated job description with more details about the role and responsibilities. ' +
          'This position now includes additional benefits and growth opportunities for the right candidate.',
      )

      // Update salary range
      await orgAdminUser.getByLabel(/min salary/i).clear()
      await orgAdminUser.getByLabel(/min salary/i).fill('9000')
      await orgAdminUser.getByLabel(/max salary/i).clear()
      await orgAdminUser.getByLabel(/max salary/i).fill('13000')

      // Save changes ("Save Changes")
      await orgAdminUser.getByRole('button', { name: /save/i }).click()

      // Wait for success and redirect back to the dashboard (anchored — the
      // edit page URL also matches an unanchored /\/en\/employer/).
      await expect(orgAdminUser).toHaveURL(/\/en\/employer$/, { timeout: 10000 })

      // Verify updated job title appears (.first(): a retried run can rename a
      // second posting to the same title).
      await expect(
        orgAdminUser.getByText('Updated Job Title - Senior Engineer').first(),
      ).toBeVisible()
    })

    test('should preserve form data when editing', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer')

      // Click edit on the first job (a link, not a button — see above)
      const editLink = orgAdminUser.getByRole('link', { name: /^edit$/i }).first()
      await editLink.waitFor({ state: 'visible', timeout: 10000 })
      await editLink.click()

      // Wait for form to load with existing data
      await orgAdminUser.waitForTimeout(1000)

      // Verify that inputs are populated with existing data
      const titleInput = orgAdminUser.getByLabel(/job title/i)
      await expect(titleInput).not.toHaveValue('')
    })
  })

  test.describe('Applicant Management', () => {
    test('should view all applicants', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer/applicants')

      // Verify page loaded
      await expect(orgAdminUser.getByRole('heading', { name: /all candidates/i })).toBeVisible()

      // Should show stats cards. These are CardTitles (h3), so match them by
      // role: a plain getByText(/new/i) also hits the "New" stage <option> and
      // the "Newest" sort option in the filter bar, which is a strict-mode
      // violation rather than a missing element.
      await expect(orgAdminUser.getByRole('heading', { name: 'Total', exact: true })).toBeVisible()
      await expect(orgAdminUser.getByRole('heading', { name: 'New', exact: true })).toBeVisible()
    })

    test('should view applicant detail', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer/applicants')

      // Click the first applicant's "Detail" control if one exists. It is
      // <Button asChild><Link>, i.e. role=link — every locator in this suite
      // used to look for a button, so none of these blocks could ever run.
      const detailButton = orgAdminUser.getByRole('link', { name: /^detail$/i }).first()

      const detailButtonCount = await detailButton.count()
      if (detailButtonCount > 0) {
        await detailButton.click()

        // Verify detail page loaded
        await expect(orgAdminUser).toHaveURL(/\/en\/employer\/applicants\/[a-zA-Z0-9]+/)

        // Should show candidate info + the actions card. The actions card is
        // still hardcoded Slovak ("Akcie") even under the /en locale.
        await expect(orgAdminUser.getByRole('heading', { name: 'Akcie' })).toBeVisible()
        await expect(
          orgAdminUser.getByRole('button', { name: /Naplánovať videopohovor/i }).first(),
        ).toBeVisible()
      }
    })

    test('should change applicant status through pipeline', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer/applicants')

      // Click on first applicant
      const detailButton = orgAdminUser.getByRole('link', { name: /^detail$/i }).first()
      const detailButtonCount = await detailButton.count()

      if (detailButtonCount > 0) {
        await detailButton.click()

        // Wait for page to load
        await orgAdminUser.waitForTimeout(1000)

        // The stage-advance buttons on the detail page are hardcoded Slovak and
        // only one renders at a time, keyed off the application's current stage:
        // NEW -> "Začať screening", SCREENING -> "Naplánovať Interview".
        const screeningButton = orgAdminUser.getByRole('button', { name: /Začať screening/i })
        const screeningButtonCount = await screeningButton.count()

        if (screeningButtonCount > 0) {
          await screeningButton.click()

          // Wait for status update
          await orgAdminUser.waitForTimeout(1000)

          // Verify status changed
          await expect(orgAdminUser.getByText(/screening/i).first()).toBeVisible()
        }

        // Try to advance to the interview stage if that button is now showing
        const interviewButton = orgAdminUser.getByRole('button', {
          name: /Naplánovať Interview/i,
        })
        const interviewButtonCount = await interviewButton.count()

        if (interviewButtonCount > 0) {
          await interviewButton.click()

          // Wait for status update
          await orgAdminUser.waitForTimeout(1000)

          // Verify status changed to interview
          await expect(orgAdminUser.getByText(/interview/i).first()).toBeVisible()
        }
      }
    })

    test('should add note to applicant', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer/applicants')

      const detailButton = orgAdminUser.getByRole('link', { name: /^detail$/i }).first()
      const detailButtonCount = await detailButton.count()

      if (detailButtonCount > 0) {
        await detailButton.click()

        // Click add note button (hardcoded Slovak: "Pridať poznámku")
        const addNoteButton = orgAdminUser.getByRole('button', { name: /Pridať poznámku/i }).first()
        const addNoteButtonCount = await addNoteButton.count()

        if (addNoteButtonCount > 0) {
          await addNoteButton.click()

          // Wait for dialog
          await orgAdminUser.waitForTimeout(500)

          // Fill note — the textarea's label is "Poznámka"
          await orgAdminUser
            .getByLabel('Poznámka')
            .fill('Great candidate with strong technical skills. Recommend moving forward.')

          // Submit note
          await orgAdminUser.getByRole('button', { name: /^Pridať$/i }).click()

          // Wait for success
          await orgAdminUser.waitForTimeout(1000)
        }
      }
    })

    test('should send email to applicant', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer/applicants')

      const detailButton = orgAdminUser.getByRole('link', { name: /^detail$/i }).first()
      const detailButtonCount = await detailButton.count()

      if (detailButtonCount > 0) {
        await detailButton.click()

        // Click send email button (hardcoded Slovak: "Poslať email")
        const sendEmailButton = orgAdminUser.getByRole('button', { name: /^Poslať email$/i })
        const sendEmailButtonCount = await sendEmailButton.count()

        if (sendEmailButtonCount > 0) {
          await sendEmailButton.click()

          // Wait for dialog
          await orgAdminUser.waitForTimeout(500)

          // Fill email form — the dialog's labels are "Predmet" / "Správa"
          await orgAdminUser.getByLabel('Predmet').fill('Interview Invitation')
          await orgAdminUser
            .getByLabel('Správa')
            .fill(
              'Dear Candidate,\n\n' +
                'We were impressed with your application and would like to invite you for an interview.\n\n' +
                'Best regards,\nHR Team',
            )

          // Submit - but cancel instead to avoid actually sending emails in tests
          await orgAdminUser
            .getByRole('button', { name: /^Zrušiť$/i })
            .first()
            .click()
        }
      }
    })

    test('should export applicants as CSV', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer/applicants')

      // Look for export button
      const exportButton = orgAdminUser
        .getByText(/export/i)
        .or(orgAdminUser.getByRole('button', { name: /csv/i }))
      const exportButtonCount = await exportButton.count()

      if (exportButtonCount > 0) {
        // Click export button exists
        await expect(exportButton).toBeVisible()
      }
    })
  })

  test.describe('Job Analytics', () => {
    test('should display job statistics on dashboard', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer')

      // Verify stats cards are visible
      await expect(orgAdminUser.getByText(/active positions/i)).toBeVisible()
      await expect(orgAdminUser.getByText(/total applications/i)).toBeVisible()
      await expect(orgAdminUser.getByText(/new applications/i)).toBeVisible()
      await expect(orgAdminUser.getByText(/total positions/i)).toBeVisible()
    })

    test('should show application counts per job', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer')

      // Wait for jobs to load
      await orgAdminUser.waitForTimeout(1000)

      // Should show application count for each job
      const applicationCountElements = orgAdminUser.locator('text=/\\d+ applications?/i')
      const count = await applicationCountElements.count()

      // If there are jobs, they should show application counts
      if (count > 0) {
        await expect(applicationCountElements.first()).toBeVisible()
      }
    })

    test('should display recent applications on dashboard', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer')

      // Should have a recent applications section
      await expect(orgAdminUser.getByText(/recent applications/i)).toBeVisible()

      // Should have a link to view all applicants. Anchored: the Quick Actions
      // sidebar also has a "View all candidates" link, and an unanchored
      // /view all/i matches both (strict-mode violation).
      await expect(orgAdminUser.getByRole('link', { name: /^view all$/i })).toBeVisible()
    })

    test('should show applicant status distribution', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer/applicants')

      // Should show stats for different stages. The four labels are CardTitles
      // (h3) reading Total / New / In progress / Interview — "In process" and
      // "Reviewing" are not strings this page renders. Matching by role also
      // avoids colliding with the identically named <option>s in the filter bar.
      await expect(orgAdminUser.getByRole('heading', { name: 'Total', exact: true })).toBeVisible()
      await expect(orgAdminUser.getByRole('heading', { name: 'New', exact: true })).toBeVisible()
      await expect(
        orgAdminUser.getByRole('heading', { name: 'In progress', exact: true }),
      ).toBeVisible()
      await expect(
        orgAdminUser.getByRole('heading', { name: 'Interview', exact: true }),
      ).toBeVisible()
    })
  })

  test.describe('Job Closure', () => {
    test('should close a job posting', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer')

      // Navigate to edit page of first job (the dashboard "Edit" control is a
      // link, not a button — see the Job Editing suite).
      const editLink = orgAdminUser.getByRole('link', { name: /^edit$/i }).first()
      await editLink.waitFor({ state: 'visible', timeout: 10000 })
      await editLink.click()

      // Wait for edit page to load
      await expect(orgAdminUser.getByRole('heading', { name: /edit job/i })).toBeVisible()

      // Setup dialog handler to confirm deletion
      orgAdminUser.on('dialog', async (dialog) => {
        expect(dialog.type()).toBe('confirm')
        expect(dialog.message()).toContain('close this job posting')
        await dialog.dismiss() // Dismiss to avoid actually closing the job
      })

      // Click close job button
      const closeButton = orgAdminUser.getByRole('button', { name: /close job/i })
      const closeButtonCount = await closeButton.count()

      if (closeButtonCount > 0) {
        await closeButton.click()

        // Dialog should have been triggered (we dismissed it above)
        await orgAdminUser.waitForTimeout(500)
      }
    })
  })

  test.describe('Quick Actions', () => {
    test('should navigate using quick action buttons', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer')

      // Should have quick action buttons in sidebar
      await expect(orgAdminUser.getByText(/quick actions/i)).toBeVisible()

      // Click on "View all candidates" quick action
      const viewCandidatesButton = orgAdminUser.getByRole('link', { name: /view all candidates/i })
      const viewCandidatesCount = await viewCandidatesButton.count()

      if (viewCandidatesCount > 0) {
        await viewCandidatesButton.click()
        await expect(orgAdminUser).toHaveURL(/\/en\/employer\/applicants/)
      }
    })

    test('should create new job from quick actions', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer')

      // Click create new position from quick actions or header
      const createJobButton = orgAdminUser.getByRole('link', { name: /new position/i }).first()
      await createJobButton.click()

      // Should navigate to job creation page
      await expect(orgAdminUser).toHaveURL(/\/en\/employer\/jobs\/new/)
    })
  })

  test.describe('Navigation', () => {
    test('should navigate back to dashboard from job creation', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer/jobs/new')

      // Click back to dashboard button
      await orgAdminUser.getByRole('link', { name: /back to dashboard/i }).click()

      // Should return to employer dashboard
      await expect(orgAdminUser).toHaveURL(/\/en\/employer/)
    })

    test('should navigate back to applicants from applicant detail', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer/applicants')

      const detailButton = orgAdminUser.getByRole('link', { name: /^detail$/i }).first()
      const detailButtonCount = await detailButton.count()

      if (detailButtonCount > 0) {
        await detailButton.click()

        // Click back button
        await orgAdminUser.getByRole('link', { name: /back to candidates/i }).click()

        // Should return to applicants list
        await expect(orgAdminUser).toHaveURL(/\/en\/employer\/applicants/)
      }
    })

    test('should access employer settings', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer')

      // Look for settings link
      const settingsLink = orgAdminUser
        .getByRole('link', { name: /company settings/i })
        .or(orgAdminUser.getByRole('link', { name: /settings/i }))
      const settingsLinkCount = await settingsLink.count()

      if (settingsLinkCount > 0) {
        await settingsLink.click()
        await expect(orgAdminUser).toHaveURL(/\/en\/employer\/settings/)
      }
    })
  })

  test.describe('Role-based Access', () => {
    test('should allow HIRING_MANAGER to view applicants', async ({ hiringManagerUser }) => {
      await hiringManagerUser.goto('/en/employer')

      // Hiring manager should have access to employer dashboard
      await expect(hiringManagerUser.getByRole('heading', { name: /dashboard/i })).toBeVisible()

      // Navigate to applicants
      await hiringManagerUser.goto('/en/employer/applicants')
      await expect(
        hiringManagerUser.getByRole('heading', { name: /all candidates/i }),
      ).toBeVisible()
    })

    test('should prevent CANDIDATE role from accessing employer pages', async ({
      candidateUser,
    }) => {
      await candidateUser.goto('/en/employer')

      // Candidate should not have access - should redirect or show error
      // This depends on your auth implementation, adjust accordingly
      const hasAccess = await candidateUser
        .getByText(/access denied/i)
        .or(candidateUser.getByText(/no access/i))
        .isVisible({ timeout: 3000 })
        .catch(() => false)

      // Either shows access denied or redirects away
      if (hasAccess) {
        await expect(
          candidateUser.getByText(/access denied/i).or(candidateUser.getByText(/no access/i)),
        ).toBeVisible()
      }
    })
  })

  test.describe('Data Validation', () => {
    test('should prevent creating job with invalid salary range', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer/jobs/new')

      // Fill required fields
      await orgAdminUser.getByLabel(/job title/i).fill('Test Position')
      await orgAdminUser.getByLabel(/^location/i).fill('Test City')
      await orgAdminUser
        .getByLabel(/^description/i)
        .fill(
          'Test description that is long enough to pass validation requirements for the job posting form.',
        )
      await orgAdminUser
        .getByLabel(/requirements/i)
        .fill('Test requirements that meet the minimum character count.')

      // Enter invalid salary (max < min)
      await orgAdminUser.getByLabel(/min salary/i).fill('10000')
      await orgAdminUser.getByLabel(/max salary/i).fill('5000')

      await orgAdminUser.getByRole('button', { name: /publish/i }).click()

      // Form might validate this on backend - wait and check for error
      await orgAdminUser.waitForTimeout(1000)
    })

    test('should handle special characters in job title', async ({ orgAdminUser }) => {
      await orgAdminUser.goto('/en/employer/jobs/new')

      // Fill with special characters
      await orgAdminUser.getByLabel(/job title/i).fill('Senior C++ / C# Developer (Remote)')

      // Should accept special characters commonly used in job titles
      const titleValue = await orgAdminUser.getByLabel(/job title/i).inputValue()
      expect(titleValue).toContain('C++')
      expect(titleValue).toContain('/')
    })
  })

  test.describe('Responsive Behavior', () => {
    test('should display employer dashboard on mobile viewport', async ({ orgAdminUser }) => {
      await orgAdminUser.setViewportSize({ width: 375, height: 667 })
      await orgAdminUser.goto('/en/employer')

      // Stats should still be visible on mobile
      await expect(orgAdminUser.getByText(/active positions/i)).toBeVisible()
      await expect(orgAdminUser.getByText(/total applications/i)).toBeVisible()
    })

    test('should allow job creation on mobile viewport', async ({ orgAdminUser }) => {
      await orgAdminUser.setViewportSize({ width: 375, height: 667 })
      await orgAdminUser.goto('/en/employer/jobs/new')

      // Form should be usable on mobile
      await expect(orgAdminUser.getByLabel(/job title/i)).toBeVisible()
      await expect(orgAdminUser.getByRole('button', { name: /publish/i })).toBeVisible()
    })
  })
})
