import { describe, expect, it } from 'vitest'
import { LEGAL_STATUS, legalValue, missingLegalFields } from './legal'

describe('規約の確定項目', () => {
  it('未確定の項目が残っている間は正式版にならず、【未確定】と表示する', () => {
    expect(missingLegalFields()).toEqual(['operatorName', 'contactEmail', 'addressPolicy', 'liabilityCap', 'court', 'dataRegion', 'effectiveDate'])
    expect(LEGAL_STATUS).toBe('draft')
    expect(legalValue('operatorName', '運営者名')).toBe('【未確定】運営者名')
  })
})
