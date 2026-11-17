import { describe, it, expect } from 'vitest'
import { assertLocalDatabase } from '../../../../../packages/db/assert-local-database'

describe('assertLocalDatabase (seed safety guard)', () => {
  it('allows plain local databases', () => {
    expect(() => assertLocalDatabase('postgresql://u:p@localhost:5432/db')).not.toThrow()
    expect(() => assertLocalDatabase('postgresql://u:p@127.0.0.1:5433/db')).not.toThrow()
    expect(() => assertLocalDatabase('postgresql://u:p@[::1]:5432/db')).not.toThrow()
  })

  it('rejects remote hosts', () => {
    expect(() => assertLocalDatabase('postgresql://u:p@prod.neon.tech/db')).toThrow(/Refusing/)
    expect(() => assertLocalDatabase('postgresql://u:p@localhost.evil.com/db')).toThrow(/Refusing/)
    expect(() => assertLocalDatabase('postgresql://localhost@evil.com/db')).toThrow(/Refusing/)
  })

  it('rejects a ?host= override that points elsewhere', () => {
    expect(() => assertLocalDatabase('postgresql://u:p@localhost/db?host=prod.neon.tech')).toThrow(
      /override/,
    )
    expect(() => assertLocalDatabase('postgresql://u:p@localhost/db?hostaddr=10.0.0.5')).toThrow(
      /override/,
    )
  })

  it('rejects unset or invalid URLs', () => {
    expect(() => assertLocalDatabase('')).toThrow(/Refusing/)
    expect(() => assertLocalDatabase('not a url')).toThrow(/Refusing/)
  })
})
