import { describe, it, expect } from 'vitest'
import { correctIndexesSchema, createAssessmentSchema } from '../assessment.schema'

describe('correctIndexesSchema', () => {
  it('coerces the builder’s comma-separated text input into numbers', () => {
    expect(correctIndexesSchema.parse('0,1,3')).toEqual([0, 1, 3])
    expect(correctIndexesSchema.parse(' 2 , 4 ')).toEqual([2, 4])
  })

  it('drops non-numeric fragments instead of failing the whole form', () => {
    expect(correctIndexesSchema.parse('1,abc,2')).toEqual([1, 2])
    expect(correctIndexesSchema.parse('')).toEqual([])
  })

  it('passes arrays (API callers, untouched defaults) through unchanged', () => {
    expect(correctIndexesSchema.parse([0, 2])).toEqual([0, 2])
    expect(correctIndexesSchema.parse(undefined)).toBeUndefined()
  })

  it('still rejects values that are not index lists', () => {
    expect(correctIndexesSchema.safeParse([1.5]).success).toBe(false)
    expect(correctIndexesSchema.safeParse({ a: 1 }).success).toBe(false)
  })
})

describe('createAssessmentSchema with an edited multi-select question', () => {
  it('accepts the raw string the form holds before submit', () => {
    const parsed = createAssessmentSchema.safeParse({
      name: 'Multi-Select Test',
      sections: [
        {
          title: 'Section 1',
          questions: [
            {
              type: 'MULTI_SELECT',
              text: 'Which are React hooks?',
              choices: ['useState', 'useEffect', 'componentDidMount', 'useContext'],
              correctIndexes: '0,1,3',
            },
          ],
        },
      ],
    })

    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.sections[0].questions[0].correctIndexes).toEqual([0, 1, 3])
    }
  })
})
