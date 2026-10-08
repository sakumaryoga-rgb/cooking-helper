import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { Layout } from './Layout'
import { supabase } from '@/supabaseClient'

vi.mock('@/supabaseClient', () => ({ supabase: { auth: { signOut: vi.fn().mockResolvedValue({ error: null }) } } }))

describe('サインアウト', () => {
  it('押した端末だけをログアウトする(scope: local)', async () => {
    render(
      <MemoryRouter>
        <Layout groupName="テスト家" />
      </MemoryRouter>
    )
    await userEvent.click(screen.getByRole('button', { name: 'サインアウト' }))
    expect(supabase.auth.signOut).toHaveBeenCalledTimes(1)
    expect(supabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})
