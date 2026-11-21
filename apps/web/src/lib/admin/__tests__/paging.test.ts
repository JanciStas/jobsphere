import { describe, it, expect } from 'vitest'
import { parsePageNumber, parseLimit, MAX_PAGE } from '../paging'

describe('parsePageNumber', () => {
  it.each([
    [undefined, 1],
    [null, 1],
    ['', 1],
    ['abc', 1],
    ['NaN', 1],
    ['-5', 1],
    ['0', 1],
    ['Infinity', 1],
    ['1e20', MAX_PAGE],
    ['3.7', 3],
    ['42', 42],
  ])('%s -> %s', (raw, expected) => {
    expect(parsePageNumber(raw as string | null | undefined)).toBe(expected)
  })
})

describe('parseLimit', () => {
  it('clamps and falls back', () => {
    expect(parseLimit(null, 25)).toBe(25)
    expect(parseLimit('abc', 50)).toBe(50)
    expect(parseLimit('1e9', 50)).toBe(100)
    expect(parseLimit('Infinity', 50)).toBe(50)
    expect(parseLimit('10', 50)).toBe(10)
  })
})
