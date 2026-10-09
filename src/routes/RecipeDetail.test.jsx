import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RecipeDetail } from './RecipeDetail'
import { supabase } from '@/supabaseClient'
import { useIngredients } from '@/hooks/useIngredients'
import { useRecipes } from '@/hooks/useRecipes'
import { __resetForTests, getState } from '@/lib/swUpdate'

const updateEq = vi.fn().mockResolvedValue({ error: null })
const update = vi.fn(() => ({ eq: updateEq }))
const aliasInsert = vi.fn().mockResolvedValue({ error: null })
vi.mock('@/supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn((table) => (table === 'ingredient_aliases' ? { insert: aliasInsert } : { update, delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) })),
  },
}))
vi.mock('@/hooks/useIngredients', () => ({ useIngredients: vi.fn() }))
vi.mock('@/hooks/useRecipes', () => ({ useRecipes: vi.fn() }))
vi.mock('@/hooks/useIngredientAliases', () => ({ useIngredientAliases: () => ({ aliases: [] }) }))
const remember = vi.fn().mockResolvedValue(true)
let conversionMap = new Map()
vi.mock('@/hooks/useUnitConversions', () => ({ useUnitConversions: () => ({ conversions: conversionMap, remember }) }))
vi.mock('@/hooks/useIngredientCatalog', () => ({
  useIngredientCatalog: () => ({ catalog: [{ id: 'c-thigh', name: '鶏もも肉', unit: 'g' }, { id: 'c-breast', name: '鶏むね肉', unit: 'g' }, { id: 'c-momen', name: '木綿豆腐', unit: '丁' }, { id: 'c-kinu', name: '絹豆腐', unit: '丁' }] }),
}))
const disableRule = vi.fn()
vi.mock('@/hooks/useSubstitutions', () => ({
  useSubstitutions: () => ({ rules: [{ id: 'rule1', from_catalog_id: 'c-thigh', to_catalog_id: 'c-breast', ratio: 1, note: null }], disableRule }),
}))
const refreshLogs = vi.fn()
let cookLogs = []
vi.mock('@/hooks/useCookLogs', () => ({ useCookLogs: () => ({ logs: cookLogs, refresh: refreshLogs }) }))

const refreshIngredients = vi.fn()
const recipe = {
  id: 'r1',
  title: '親子丼',
  url: 'https://example.com/oyakodon',
  recipe_ingredients: [
    { id: 'l1', ingredient_id: 'chicken', required_quantity: 200, ingredient: { id: 'chicken', name: '鶏もも肉', unit: 'g' } },
    { id: 'l2', ingredient_id: 'egg', required_quantity: 2, ingredient: { id: 'egg', name: '卵', unit: '個' } },
  ],
}

function setup(stock) {
  useIngredients.mockReturnValue({ ingredients: stock, refresh: refreshIngredients })
  useRecipes.mockReturnValue({ recipes: [recipe], loading: false })
  return render(
    <MemoryRouter initialEntries={['/recipes/r1']}>
      <Routes>
        <Route path="/recipes/:id" element={<RecipeDetail groupId="g1" />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('RecipeDetail', () => {
  beforeEach(() => {
    supabase.rpc.mockReset()
    supabase.rpc.mockResolvedValue({ error: null })
    refreshIngredients.mockReset()
  })
  afterEach(() => __resetForTests())

  it('材料が揃っていれば「作れます」と表示する', () => {
    setup([
      { id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 300 },
      { id: 'egg', name: '卵', unit: '個', quantity: 4 },
    ])
    expect(screen.getByText('作れます')).toBeInTheDocument()
    expect(screen.getByText(/必要 200g \/ 在庫 300g/)).toBeInTheDocument()
  })

  it('不足があれば不足品目数を表示する', () => {
    setup([{ id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 100 }])
    expect(screen.getByText('あと2品')).toBeInTheDocument()
  })

  it('調理の確定で、調整した使用量と送信IDを cook_recipe_v2 に渡し、在庫と記録を再取得する', async () => {
    setup([
      { id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 300 },
      { id: 'egg', name: '卵', unit: '個', quantity: 4 },
    ])
    await userEvent.click(screen.getByRole('button', { name: /これを作る/ }))
    const dialog = await screen.findByRole('dialog')
    expect(getState().busy).toBe(true)

    const chickenInput = within(dialog).getByLabelText('鶏もも肉の使用量')
    await userEvent.clear(chickenInput)
    await userEvent.type(chickenInput, '150')
    await userEvent.click(within(dialog).getByRole('button', { name: '確定' }))

    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('cook_recipe_v2', {
        p_recipe_id: 'r1',
        p_items: [
          { ingredient_id: 'chicken', quantity: 150, substitute_for: null },
          { ingredient_id: 'egg', quantity: 2, substitute_for: null },
        ],
        p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      })
    )
    await waitFor(() => expect(refreshIngredients).toHaveBeenCalled())
    expect(refreshLogs).toHaveBeenCalled()
    await waitFor(() => expect(getState().busy).toBe(false))
  })

  it('足りない材料を代替で補えれば「代替で作れます」と出し、確定で代替先の在庫を使う', async () => {
    setup([
      { id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 50, catalog_id: 'c-thigh' },
      { id: 'breast', name: '鶏むね肉', unit: 'g', quantity: 300, catalog_id: 'c-breast' },
      { id: 'egg', name: '卵', unit: '個', quantity: 4 },
    ])
    expect(screen.getByText('代替で作れます')).toBeInTheDocument()
    const select = screen.getByLabelText('鶏もも肉の代替')
    expect(select).toHaveValue('rule1')
    expect(within(select).getByRole('option', { name: /鶏むね肉 150g/ })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /これを作る/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('鶏もも肉の代わり')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '確定' }))
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith(
        'cook_recipe_v2',
        expect.objectContaining({
          p_items: [
            { ingredient_id: 'chicken', quantity: 50, substitute_for: null },
            { ingredient_id: 'breast', quantity: 150, substitute_for: '鶏もも肉' },
            { ingredient_id: 'egg', quantity: 2, substitute_for: null },
          ],
        })
      )
    )
  })

  it('代替を使わないことにできる', async () => {
    setup([
      { id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 50, catalog_id: 'c-thigh' },
      { id: 'breast', name: '鶏むね肉', unit: 'g', quantity: 300, catalog_id: 'c-breast' },
      { id: 'egg', name: '卵', unit: '個', quantity: 4 },
    ])
    await userEvent.click(screen.getByRole('button', { name: '今後使わない' }))
    expect(disableRule).toHaveBeenCalledWith('rule1')
  })

  it('代替を「使わない」にすると不足になり、不足量を出す', async () => {
    setup([
      { id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 50, catalog_id: 'c-thigh' },
      { id: 'breast', name: '鶏むね肉', unit: 'g', quantity: 300, catalog_id: 'c-breast' },
      { id: 'egg', name: '卵', unit: '個', quantity: 4 },
    ])
    await userEvent.selectOptions(screen.getByLabelText('鶏もも肉の代替'), 'none')
    expect(screen.getByText('あと1品')).toBeInTheDocument()
    expect(screen.getByText(/不足 150g/)).toBeInTheDocument()
  })

  it('人数を変えると必要量が変わる', async () => {
    useIngredients.mockReturnValue({ ingredients: [{ id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 300 }, { id: 'egg', name: '卵', unit: '個', quantity: 4 }], refresh: refreshIngredients })
    useRecipes.mockReturnValue({ recipes: [{ ...recipe, servings: 2 }], loading: false })
    render(
      <MemoryRouter initialEntries={['/recipes/r1']}>
        <Routes>
          <Route path="/recipes/:id" element={<RecipeDetail groupId="g1" />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText('2人分')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '人数を増やす' }))
    await userEvent.click(screen.getByRole('button', { name: '人数を増やす' }))
    expect(screen.getByText('4人分')).toBeInTheDocument()
    expect(screen.getByText(/必要 400g \/ 在庫 300g/)).toBeInTheDocument()
    expect(screen.getByText(/必要 4個 \/ 在庫 4個/)).toBeInTheDocument()
    expect(screen.getByText('あと1品')).toBeInTheDocument()
  })

  it('確定のあとに数秒「取り消す」を出し、押すとその記録を取り消す', async () => {
    supabase.rpc.mockImplementation((name) => Promise.resolve(name === 'cook_recipe_v2' ? { data: 'log-new', error: null } : { error: null }))
    setup([
      { id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 300 },
      { id: 'egg', name: '卵', unit: '個', quantity: 4 },
    ])
    await userEvent.click(screen.getByRole('button', { name: /これを作る/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '確定' }))
    const toast = await screen.findByRole('status')
    await userEvent.click(within(toast).getByRole('button', { name: '取り消す' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('undo_cook', { p_cook_log_id: 'log-new' }))
  })

  it('最近作った記録を取り消せる', async () => {
    cookLogs = [{ id: 'log1', created_at: '2026-10-08T12:00:00Z', cook_log_items: [{ ingredient_name: '鶏もも肉', used_quantity: 200, unit: 'g' }] }]
    setup([{ id: 'chicken', name: '鶏もも肉', unit: 'g', quantity: 100 }])
    expect(screen.getByText('鶏もも肉 200g')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '取り消す' }))
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('undo_cook', { p_cook_log_id: 'log1' }))
    expect(refreshIngredients).toHaveBeenCalled()
    cookLogs = []
  })

  it('作り方は番号付きで、メモとカスタマイズの入り口を出す。自分で考えたレシピには印をつける', () => {
    useIngredients.mockReturnValue({ ingredients: [], refresh: refreshIngredients })
    useRecipes.mockReturnValue({
      recipes: [{ id: 'r1', title: 'わが家カレー', url: null, instructions: '1. 切る\n2. 煮る', memo: '隠し味はりんご', icon: '🍛', recipe_ingredients: [] }],
      loading: false,
    })
    render(
      <MemoryRouter initialEntries={['/recipes/r1']}>
        <Routes>
          <Route path="/recipes/:id" element={<RecipeDetail groupId="g1" />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText('わが家のオリジナル')).toBeInTheDocument()
    const steps = screen.getAllByRole('listitem').filter((li) => /切る|煮る/.test(li.textContent))
    expect(steps.map((li) => li.textContent)).toEqual(['1切る', '2煮る'])
    expect(screen.getByText('隠し味はりんご')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /編集/ })).toHaveAttribute('href', '/recipes/r1/edit')
  })

  describe('分量が数で分からない材料・確認待ちの材料', () => {
    function setupWith(lines, stock) {
      useIngredients.mockReturnValue({ ingredients: stock, refresh: refreshIngredients })
      useRecipes.mockReturnValue({ recipes: [{ id: 'r2', title: '豚丼', url: null, recipe_ingredients: lines }], loading: false, refresh: vi.fn() })
      return render(
        <MemoryRouter initialEntries={['/recipes/r2']}>
          <Routes>
            <Route path="/recipes/:id" element={<RecipeDetail groupId="g1" />} />
          </Routes>
        </MemoryRouter>
      )
    }
    const pork = { id: 'pork', name: '豚こま切れ肉', unit: 'g', quantity: 300, catalog_id: null }

    it('元の分量の表記のまま表示し、「作れる」と断定しない', () => {
      setupWith([{ id: 'l1', ingredient_id: 'pork', required_quantity: null, amount_text: '1パック', note: '冷凍', ingredient: pork }], [pork])
      expect(screen.getByText('分量を確認')).toBeInTheDocument()
      expect(screen.getByText(/1パック/)).toBeInTheDocument()
      expect(screen.getByText('状態: 冷凍')).toBeInTheDocument()
    })

    it('調理のときは、量を入れた分だけ在庫から引き、選べばその換算を覚える', async () => {
      setupWith([{ id: 'l1', ingredient_id: 'pork', required_quantity: null, amount_text: '1パック', ingredient: pork }], [pork])
      supabase.rpc.mockResolvedValue({ data: 'log1', error: null })
      await userEvent.click(screen.getByRole('button', { name: /これを作る/ }))
      expect(screen.getByRole('note')).toHaveTextContent('次の材料は在庫から引きません(分量が決まっていない: 豚こま切れ肉。使った量を入れると引きます)')
      const qty = screen.getByLabelText('豚こま切れ肉の使用量')
      expect(qty).toHaveValue(null)
      expect(screen.getByLabelText('豚こま切れ肉を使う')).not.toBeChecked()
      await userEvent.type(qty, '200')
      expect(screen.getByLabelText('豚こま切れ肉を使う')).toBeChecked()
      await userEvent.click(screen.getByRole('checkbox', { name: /次から「1パック」を 200g として覚える/ }))
      await userEvent.click(screen.getByRole('button', { name: '確定' }))
      expect(supabase.rpc).toHaveBeenCalledWith('cook_recipe_v2', expect.objectContaining({ p_items: [{ ingredient_id: 'pork', quantity: 200, substitute_for: null }] }))
      await waitFor(() => expect(remember).toHaveBeenCalledWith('pork', 'パック', 200))
    })

    it('量を入れなければ在庫から引かない', async () => {
      setupWith([{ id: 'l1', ingredient_id: 'pork', required_quantity: null, amount_text: '1パック', ingredient: pork }], [pork])
      supabase.rpc.mockResolvedValue({ data: 'log1', error: null })
      await userEvent.click(screen.getByRole('button', { name: /これを作る/ }))
      await userEvent.click(screen.getByRole('button', { name: '確定' }))
      expect(supabase.rpc).toHaveBeenCalledWith('cook_recipe_v2', expect.objectContaining({ p_items: [] }))
    })

    it('確認待ちの材料は、候補を1タップで選ぶと材料を更新し、表記を覚える', async () => {
      const momen = { id: 'momen', name: '木綿豆腐', unit: '丁', quantity: 1, catalog_id: 'c-momen' }
      setupWith([{ id: 'l2', ingredient_id: null, source_name: '豆腐', required_quantity: null, amount_text: '1/2丁' }], [momen])
      expect(screen.getByText('材料を確認')).toBeInTheDocument()
      expect(screen.getByText('確認待ち')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: '木綿豆腐' }))
      await waitFor(() => expect(update).toHaveBeenCalledWith({ ingredient_id: 'momen', source_name: null, required_quantity: 0.5 }))
      expect(updateEq).toHaveBeenCalledWith('id', 'l2')
      expect(aliasInsert).toHaveBeenCalledWith({ group_id: 'g1', catalog_id: 'c-momen', alias: '豆腐' })
    })
  
    it('覚えた換算で計算した材料は、確定画面でそのことを示し、量を直せる', async () => {
      conversionMap = new Map([['pork:パック', 200]])
      setupWith([{ id: 'l1', ingredient_id: 'pork', required_quantity: null, amount_text: '1パック', ingredient: pork }], [pork])
      expect(screen.getByText('作れます')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /これを作る/ }))
      expect(screen.getByText(/覚えた「1パック = 200g」で計算しました。商品で量が違うときは直してください/)).toBeInTheDocument()
      expect(screen.getByLabelText('豚こま切れ肉の使用量')).toHaveValue(200)
      conversionMap = new Map()
    })
  })
})
