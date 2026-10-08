import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GroupSettings } from './GroupSettings'
import { TELEMETRY_NOTICE } from '@/lib/telemetry/notice'

describe('グループ画面', () => {
  it('利用状況とエラーの記録について説明する', () => {
    render(<GroupSettings group={{ id: 'g1', name: 'テスト家', invite_code: '0A1B2C3D' }} />)
    expect(screen.getByText(TELEMETRY_NOTICE)).toBeInTheDocument()
    expect(TELEMETRY_NOTICE).toBe(
      'アプリの品質改善のため、画面の利用状況とエラー情報を記録しています。料理の内容や入力した情報は収集しません。'
    )
  })
})
