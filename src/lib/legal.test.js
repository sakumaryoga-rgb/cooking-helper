import { describe, expect, it } from 'vitest'
import { CONSENT_REQUIRED, LEGAL_INFO, LEGAL_STATUS, LEGAL_VERSIONS } from './legal'

describe('規約の確定項目', () => {
  it('すべて確定していて正式版。初めて開いたときに同意を求める', () => {
    expect(Object.values(LEGAL_INFO).every(Boolean)).toBe(true)
    expect(LEGAL_STATUS).toBe('official')
    expect(LEGAL_VERSIONS.terms).toBe(LEGAL_VERSIONS.privacy)
    expect(CONSENT_REQUIRED).toBe(true)
  })
})
