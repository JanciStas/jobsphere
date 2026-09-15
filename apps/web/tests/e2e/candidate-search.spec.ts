/**
 * E2E Test - Candidate Search
 *
 * Tests the semantic candidate search for job-specific matching.
 *
 * Two things this file used to get wrong:
 *
 * 1. Every test started at `/en/employer/jobs`. That route does not exist —
 *    `[locale]/employer/jobs/` only contains `new/` and `[id]/`. The employer's
 *    job list lives on the `/en/employer` dashboard. Because the preamble could
 *    never find a job link, five of the six tests quietly `test.skip()`d
 *    themselves and the sixth failed on the missing heading.
 * 2. The filters were addressed as `input[name=limit]` / `input[name=minSimilarity]`.
 *    The real controls are `input#limit` (number) and `input#minSimilarity`
 *    (range) — they carry ids, not name attributes.
 *
 * Result cards have no `data-testid=candidate-card`, and semantic search cannot
 * return anything in this environment anyway: it matches against pgvector
 * embeddings on Candidate/Resume rows, and the e2e seed creates none (generating
 * them needs a real embeddings provider, not ANTHROPIC_API_KEY=test-key). The
 * card-level tests are therefore skipped with that reason rather than left as
 * `if (count > 0)` blocks that can only ever pass vacuously.
 */

import { test, expect } from '../fixtures/auth'
import type { Page } from '@playwright/test'

/**
 * Open the employer dashboard and return the id of the first job it lists.
 * The dashboard links each job as `/employer/jobs/<id>/edit`.
 */
async function getFirstEmployerJobId(page: Page): Promise<string> {
  await page.goto('/en/employer')
  const editLink = page.locator('a[href*="/employer/jobs/"][href$="/edit"]').first()
  await expect(editLink).toBeVisible({ timeout: 10000 })

  const href = await editLink.getAttribute('href')
  const jobId = href?.match(/\/employer\/jobs\/([^/]+)\/edit/)?.[1]
  expect(jobId, 'employer dashboard should link at least one job').toBeTruthy()
  return jobId as string
}

test.describe('Candidate Search', () => {
  test('recruiter can open candidate search for a specific job', async ({ recruiterUser }) => {
    const jobId = await getFirstEmployerJobId(recruiterUser)

    await recruiterUser.goto(`/en/employer/jobs/${jobId}/search-candidates`)

    await expect(recruiterUser).toHaveURL(/\/employer\/jobs\/.*\/search-candidates/)
    await expect(recruiterUser.locator('h1')).toContainText('Search Candidates')

    // The page names the job it is searching for.
    await expect(recruiterUser.getByText(/find matching candidates for:/i)).toBeVisible()

    // Filters are present and editable.
    await expect(recruiterUser.locator('input#limit')).toBeVisible()
    await expect(recruiterUser.locator('input#minSimilarity')).toBeVisible()
    await expect(recruiterUser.getByRole('button', { name: /^Search$/ })).toBeEnabled()
  })

  test('candidate search runs and reports a result count', async ({ recruiterUser }) => {
    const jobId = await getFirstEmployerJobId(recruiterUser)
    await recruiterUser.goto(`/en/employer/jobs/${jobId}/search-candidates`)

    await recruiterUser.locator('input#limit').fill('10')
    await recruiterUser.locator('input#minSimilarity').fill('0.6')

    await recruiterUser.getByRole('button', { name: /^Search$/ }).click()

    // Either matches were found, or the empty state is shown. Both are a
    // completed search; a failure would surface as an error toast instead.
    await expect(
      recruiterUser
        .getByText(/candidates found/i)
        .or(recruiterUser.getByText('No candidates found matching your criteria.')),
    ).toBeVisible({ timeout: 15000 })
  })

  test('candidate search shows the empty state with a hint at a high threshold', async ({
    recruiterUser,
  }) => {
    const jobId = await getFirstEmployerJobId(recruiterUser)
    await recruiterUser.goto(`/en/employer/jobs/${jobId}/search-candidates`)

    await recruiterUser.locator('input#limit').fill('10')
    await recruiterUser.locator('input#minSimilarity').fill('1')

    await recruiterUser.getByRole('button', { name: /^Search$/ }).click()

    await expect(
      recruiterUser.getByText('No candidates found matching your criteria.'),
    ).toBeVisible({ timeout: 15000 })
    await expect(recruiterUser.getByText('Try lowering the minimum match score.')).toBeVisible()
  })

  test('candidate search shows match score breakdown', async () => {
    test.skip(
      true,
      'Needs at least one Candidate with a pgvector CV embedding; the e2e seed creates none and embeddings require a real provider. The result cards also have no data-testid=candidate-card hook.',
    )
  })

  test('candidate search action buttons are functional', async () => {
    test.skip(
      true,
      'Same gap: no seeded candidate with an embedding, so no result card ever renders to carry View Profile / Contact / Send Assessment.',
    )
  })

  test('candidate search displays contact information for candidates', async () => {
    test.skip(true, 'Same gap: no seeded candidate with an embedding, so no result card renders.')
  })
})
