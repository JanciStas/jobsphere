/**
 * E2E Test - Assessment Builder
 *
 * Tests the assessment creation and management flow.
 *
 * This file used to be written against an assessment builder that was never
 * built: it addressed questions as `questions.0.*`, clicked an "Add Question"
 * button and selected a type from a `<select>`. The real builder
 * (src/app/[locale]/employer/assessments/builder/assessment-builder-client.tsx)
 * is SECTION-based. Concretely:
 *
 *   - form paths are `sections.<s>.questions.<q>.<field>`
 *   - the form starts with one section ("Section 1", expanded) and NO questions
 *   - questions are added by clicking a type button inside the section:
 *     "Multiple Choice" | "Multi-Select" | "Short Text" | "Long Text" | "Code"
 *   - the correct answers field is a free-text input of comma-separated indexes,
 *     not a set of checkboxes
 *   - a CODE question's starter code is `...questions.<q>.code` (not starterCode)
 *   - there is no per-question rubric field in the UI
 *   - saving redirects to /{locale}/employer/assessments/{id}/results and raises
 *     a sonner toast titled "Assessment created successfully!"
 */

import { test, expect } from '../fixtures/auth'
import type { Page } from '@playwright/test'

const BUILDER_URL = '/en/employer/assessments/builder'

/** Field paths for section 0, question `q`. */
function q(index: number, field: string) {
  return `sections.0.questions.${index}.${field}`
}

/** Fill the four Basic Information fields. */
async function fillBasics(
  page: Page,
  {
    name,
    description,
    durationMin = '60',
    passingScore = '70',
  }: {
    name: string
    description?: string
    durationMin?: string
    passingScore?: string
  },
) {
  await page.fill('input[name=name]', name)
  if (description !== undefined) await page.fill('textarea[name=description]', description)
  await page.fill('input[name=durationMin]', durationMin)
  await page.fill('input[name=passingScore]', passingScore)
}

/** Add a question of `type` to the first section. */
async function addQuestion(
  page: Page,
  type: 'Multiple Choice' | 'Multi-Select' | 'Short Text' | 'Long Text' | 'Code',
) {
  await page.getByRole('button', { name: type, exact: true }).click()
}

test.describe('Assessment Builder', () => {
  test.beforeEach(async ({ recruiterUser }) => {
    await recruiterUser.goto(BUILDER_URL)
    await expect(recruiterUser).toHaveURL(/\/employer\/assessments\/builder/)
    await expect(recruiterUser.locator('h1')).toContainText('Create Assessment')
  })

  test('recruiter can create a complete assessment with multiple question types', async ({
    recruiterUser,
  }) => {
    await fillBasics(recruiterUser, {
      name: 'JavaScript Skills Test E2E',
      description: 'Comprehensive JavaScript test for React developers',
    })

    // Question 1 — multiple choice. The type button seeds four choices and
    // correctIndexes [0], so only the text needs filling.
    await addQuestion(recruiterUser, 'Multiple Choice')
    const firstQuestionText = recruiterUser.locator(`textarea[name="${q(0, 'text')}"]`)
    await expect(firstQuestionText).toBeVisible()
    await firstQuestionText.fill('What is the purpose of React hooks?')

    await recruiterUser
      .locator(`input[name="${q(0, 'choices.0')}"]`)
      .fill('To manage state and side effects in functional components')
    await recruiterUser
      .locator(`input[name="${q(0, 'choices.1')}"]`)
      .fill('To create class components')
    await recruiterUser.locator(`input[name="${q(0, 'choices.2')}"]`).fill('To style components')

    // Question 2 — code.
    await addQuestion(recruiterUser, 'Code')
    await recruiterUser
      .locator(`textarea[name="${q(1, 'text')}"]`)
      .fill('Write a function that returns the sum of two numbers')
    await recruiterUser.selectOption(`select[name="${q(1, 'language')}"]`, 'javascript')
    await recruiterUser
      .locator(`textarea[name="${q(1, 'code')}"]`)
      .fill('function sum(a, b) {\n  // Your code here\n}')

    // Question 3 — short text.
    await addQuestion(recruiterUser, 'Short Text')
    await recruiterUser
      .locator(`textarea[name="${q(2, 'text')}"]`)
      .fill('Explain the difference between var, let, and const')

    await recruiterUser.getByRole('button', { name: /create assessment/i }).click()

    // Saving lands on the assessment's results page.
    await expect(recruiterUser).toHaveURL(/\/employer\/assessments\/[^/]+\/results/, {
      timeout: 15000,
    })
  })

  test('assessment builder shows validation errors for required fields', async ({
    recruiterUser,
  }) => {
    // Submit with an empty name and a section that has no questions.
    await recruiterUser.getByRole('button', { name: /create assessment/i }).click()

    await expect(recruiterUser).toHaveURL(/\/employer\/assessments\/builder/)
    // zod (via zodResolver) blocks the submit and renders a field error.
    await expect(recruiterUser.locator('p.text-destructive').first()).toBeVisible()
  })

  test('recruiter can remove questions from assessment', async ({ recruiterUser }) => {
    await fillBasics(recruiterUser, {
      name: 'Test Assessment',
      durationMin: '30',
      passingScore: '60',
    })

    await addQuestion(recruiterUser, 'Short Text')
    await addQuestion(recruiterUser, 'Short Text')

    const questions = recruiterUser.locator(
      'textarea[name^="sections.0.questions."][name$=".text"]',
    )
    await expect(questions).toHaveCount(2)

    // The delete buttons are icon-only; they carry an aria-label so they are
    // addressable (and announced) by name.
    await recruiterUser.getByRole('button', { name: 'Delete question 2' }).click()

    await expect(questions).toHaveCount(1)
  })

  test('assessment builder supports multi-select questions with several correct answers', async ({
    recruiterUser,
  }) => {
    await fillBasics(recruiterUser, {
      name: 'Multi-Select Test',
      durationMin: '30',
      passingScore: '50',
    })

    await addQuestion(recruiterUser, 'Multi-Select')
    await recruiterUser
      .locator(`textarea[name="${q(0, 'text')}"]`)
      .fill('Which of the following are React hooks? (Select all that apply)')

    await recruiterUser.locator(`input[name="${q(0, 'choices.0')}"]`).fill('useState')
    await recruiterUser.locator(`input[name="${q(0, 'choices.1')}"]`).fill('useEffect')
    await recruiterUser.locator(`input[name="${q(0, 'choices.2')}"]`).fill('componentDidMount')
    await recruiterUser.locator(`input[name="${q(0, 'choices.3')}"]`).fill('useContext')

    // Correct answers are entered as comma-separated indexes in a text input.
    await recruiterUser.locator(`input[name="${q(0, 'correctIndexes')}"]`).fill('0,1,3')

    await recruiterUser.getByRole('button', { name: /create assessment/i }).click()

    await expect(recruiterUser).toHaveURL(/\/employer\/assessments\/[^/]+\/results/, {
      timeout: 15000,
    })
  })

  test('assessment builder allows editing question points and skill tag', async ({
    recruiterUser,
  }) => {
    await fillBasics(recruiterUser, { name: 'Points Test', durationMin: '45', passingScore: '60' })

    await addQuestion(recruiterUser, 'Long Text')
    await recruiterUser.locator(`textarea[name="${q(0, 'text')}"]`).fill('Describe your experience')
    await recruiterUser.locator(`input[name="${q(0, 'points')}"]`).fill('10')
    await recruiterUser.locator(`input[name="${q(0, 'skillTag')}"]`).fill('Communication')

    await recruiterUser.getByRole('button', { name: /create assessment/i }).click()

    await expect(recruiterUser).toHaveURL(/\/employer\/assessments\/[^/]+\/results/, {
      timeout: 15000,
    })
  })

  test('assessment builder rejects an out-of-range duration and passing score', async ({
    recruiterUser,
  }) => {
    // durationMin must be a positive int <= 480; passingScore must be 0..100.
    await fillBasics(recruiterUser, {
      name: 'Invalid Test',
      description: 'Test description',
      durationMin: '-10',
      passingScore: '150',
    })

    await addQuestion(recruiterUser, 'Short Text')
    await recruiterUser.locator(`textarea[name="${q(0, 'text')}"]`).fill('Test question')

    await recruiterUser.getByRole('button', { name: /create assessment/i }).click()

    // Submission is blocked and we stay on the builder with a field error shown.
    await expect(recruiterUser).toHaveURL(/\/employer\/assessments\/builder/)
    await expect(recruiterUser.locator('p.text-destructive').first()).toBeVisible()
  })
})
