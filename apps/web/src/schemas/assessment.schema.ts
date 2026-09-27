import { z } from 'zod'

// The builder edits correct answers in a plain text input ("0,2"), so the form
// value is a string until submit. zodResolver validates before onSubmit runs, so
// without this coercion every edited MCQ/MULTI_SELECT question was rejected by
// `z.array(z.number())` and the form silently refused to submit. Arrays (API
// callers, untouched defaults) pass through unchanged.
export const correctIndexesSchema = z.preprocess(
  (value) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((part) => parseInt(part.trim(), 10))
          .filter((n) => !Number.isNaN(n))
      : value,
  z.array(z.number().int().nonnegative()).optional(),
)

export const questionSchema = z
  .object({
    type: z.enum(['MCQ', 'MULTI_SELECT', 'SHORT_TEXT', 'LONG_TEXT', 'CODE']),
    text: z.string().min(1).max(5000),
    choices: z.array(z.string()).optional(),
    correctIndexes: correctIndexesSchema,
    code: z.string().max(10000).optional(),
    language: z.string().optional(),
    skillTag: z.string().max(50).optional(),
    points: z.number().int().positive().default(1),
    rubric: z.record(z.any()).optional(),
    order: z.number().int().min(0).default(0),
  })
  .superRefine((question, ctx) => {
    // A correct index must point at an existing choice.
    const max = question.choices?.length
    if (max === undefined || !question.correctIndexes) return
    question.correctIndexes.forEach((index) => {
      if (index >= max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['correctIndexes'],
          message: `Correct answer ${index} does not match any choice (0-${max - 1})`,
        })
      }
    })
  })

export const assessmentSectionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  order: z.number().int().min(0).default(0),
  questions: z.array(questionSchema).min(1),
})

export const createAssessmentSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  locale: z.string().length(2).default('sk'),
  durationMin: z.number().int().positive().max(480).optional(),
  passingScore: z.number().min(0).max(100).optional(),
  randomize: z.boolean().default(false),
  settings: z.record(z.any()).optional(),
  active: z.boolean().default(true),
  sections: z.array(assessmentSectionSchema).min(1),
})

export const submitAnswerSchema = z.object({
  questionId: z.string().cuid(),
  response: z.any(), // This will be validated based on question type
})

export const submitAttemptSchema = z.object({
  inviteToken: z.string(),
  answers: z.array(submitAnswerSchema),
})

export type CreateAssessmentInput = z.infer<typeof createAssessmentSchema>
export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>
export type SubmitAttemptInput = z.infer<typeof submitAttemptSchema>
