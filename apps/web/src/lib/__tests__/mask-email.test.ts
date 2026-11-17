import { describe, it, expect } from 'vitest'
import { maskEmail } from '../mask-email'

describe('maskEmail', () => {
  it('keeps first char and domain, hides the rest of the local part', () => {
    expect(maskEmail('jan.novak@example.com')).toBe('j***@example.com')
  })

  it('never leaks the full local part', () => {
    expect(maskEmail('secret.person@corp.sk')).not.toContain('secret')
  })

  it('returns *** for values without a domain', () => {
    expect(maskEmail('not-an-email')).toBe('***')
    expect(maskEmail('')).toBe('***')
  })

  it('handles null/undefined safely', () => {
    expect(maskEmail(null)).toBe('***')
    expect(maskEmail(undefined)).toBe('***')
  })
})
