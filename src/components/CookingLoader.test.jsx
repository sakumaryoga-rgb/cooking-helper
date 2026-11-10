import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CookingLoader } from './CookingLoader'

describe('CookingLoader', () => {
  it('読み込み中であることを文字と status で伝える(フライパンの絵は読み上げない)', () => {
    render(<CookingLoader />)
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中...')
    expect(screen.getByRole('status').querySelector('[aria-hidden="true"]')).toBeInTheDocument()
  })

  it('文言を変えられる', () => {
    render(<CookingLoader label="レシピを読み込んでいます..." />)
    expect(screen.getByText('レシピを読み込んでいます...')).toBeInTheDocument()
  })
})
