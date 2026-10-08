import { describe, expect, it } from 'vitest'
import { normalizePath } from './paths'

describe('画面パスの正規化', () => {
  it.each([
    ['/fridge', '/fridge'],
    ['/recipes', '/recipes'],
    ['/recipes/new', '/recipes/new'],
    ['/recipes/123e4567-e89b-12d3-a456-426614174000', '/recipes/:id'],
    ['/group', '/group'],
    ['/onboarding?code=ABCD1234', '/onboarding'],
    ['/auth/callback#access_token=secret', '/auth/callback'],
    ['/fridge/', '/fridge'],
    ['/unknown/page', '/other'],
    ['', '/'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePath(input)).toBe(expected)
  })

  it('結果は DB の形式チェック(英小文字・/・:・- のみ、64文字以内)を満たす', () => {
    for (const p of ['/recipes/abc', '/x?y=1', '/onboarding?code=ZZ', '/auth/callback']) {
      expect(normalizePath(p)).toMatch(/^\/[a-z/:-]{0,63}$/)
    }
  })
})
