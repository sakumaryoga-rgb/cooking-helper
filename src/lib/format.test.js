import { describe, expect, it } from 'vitest'
import { formatQuantity } from './format'

describe('formatQuantity', () => {
  it.each([
    [3, '3'],
    ['200', '200'],
    [1.25, '1.25'],
    [0.1 + 0.2, '0.3'],
    [0.5, '0.5'],
    ['abc', '0'],
  ])('%s → %s', (input, expected) => {
    expect(formatQuantity(input)).toBe(expected)
  })
})
