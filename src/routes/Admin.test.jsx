import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Admin } from './Admin'
import { supabase } from '@/supabaseClient'

vi.mock('@/supabaseClient', () => ({ supabase: { rpc: vi.fn() } }))
vi.mock('@/lib/contactNotify', () => ({ requestContactNotification: vi.fn() }))

const dashboard = { days: 30, daily: [], monthly: [], versions: [], errors_daily: [], errors_top: [], imports: [], contacts: [], retention: {} }
const failures = {
  days: 30,
  by_host: [{ host: 'blog.example.com', count: 3, users: 2, reasons: { no_recipe_data: 2, robots_disallowed: 1 }, last_seen: '2026-11-09T10:00:00Z' }],
  recent: [{ created_at: '2026-11-09T10:00:00Z', site: 'generic', host: 'blog.example.com', path: '/r/1', reason: 'no_recipe_data', http_status: 200, features: { ld_types: ['Article'], spa_hint: true } }],
  methods: [{ site: 'generic', method: 'heuristic', count: 4 }],
}

describe('管理画面: 取り込めなかったページ', () => {
  it('ドメインごとの件数と理由、最近の例のページの特徴、読み取れた方法を出す', async () => {
    supabase.rpc.mockImplementation((name) => Promise.resolve({ data: name === 'admin_import_failures' ? failures : dashboard, error: null }))
    render(<Admin />)
    expect(await screen.findByText('材料が見つからない 2・robots.txt で禁止 1')).toBeInTheDocument()
    expect(screen.getByText('blog.example.com/r/1')).toBeInTheDocument()
    expect(screen.getByText('JSON-LD: Article・JavaScript で描くページ')).toBeInTheDocument()
    expect(screen.getByText('材料の見出し')).toBeInTheDocument()
    expect(supabase.rpc).toHaveBeenCalledWith('admin_import_failures', { p_days: 30 })
  })

  it('集計がない(migration 031 の適用前・運営者でない)ときは出さない', async () => {
    supabase.rpc.mockImplementation((name) =>
      Promise.resolve(name === 'admin_import_failures' ? { data: null, error: { message: 'function does not exist' } } : { data: dashboard, error: null })
    )
    render(<Admin />)
    expect(await screen.findByText(/レシピ取り込み/)).toBeInTheDocument()
    expect(screen.queryByText(/取り込めなかったサイト/)).not.toBeInTheDocument()
  })
})
