import { describe, expect, it } from 'vitest'
import { isDbEnabledFor } from './runtimeEnv'

describe('isDbEnabledFor', () => {
  it.each([
    ['production', true],
    ['local', true],
    ['preview', false],
    ['development', false],
    [undefined, false],
  ])('%s → %s', (env, expected) => {
    expect(isDbEnabledFor(env)).toBe(expected)
  })
})
