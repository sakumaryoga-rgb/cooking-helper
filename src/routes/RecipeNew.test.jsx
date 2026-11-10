import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { RecipeNew } from './RecipeNew'
import { fetchRecipeFromUrl } from '@/lib/recipeImport/client'
import { findDuplicate, saveRecipe } from '@/lib/recipeImport/save'
import { supabase } from '@/supabaseClient'

// update(...).in(...) の呼び出しを記録する。ほかの読み込みは空の結果を返す
const updates = []
vi.mock('@/supabaseClient', () => {
  const chain = () => {
    const result = Promise.resolve({ data: [], error: null })
    const c = new Proxy(function () {}, {
      get: (_, k) => (k === 'then' ? result.then.bind(result) : k === 'update' ? (patch) => ({ in: (col, ids) => (updates.push({ patch, col, ids }), Promise.resolve({ error: null })) }) : () => c),
      apply: () => c,
    })
    return c
  }
  return { supabase: { rpc: vi.fn().mockResolvedValue({ error: null }), from: vi.fn(() => chain()) } }
})
vi.mock('@/hooks/useIngredients', () => ({ useIngredients: () => ({ ingredients: [{ id: 'i1', name: 'きゅうり', unit: '本', quantity: 2 }] }) }))
vi.mock('@/hooks/useIngredientCatalog', () => ({ useIngredientCatalog: () => ({ catalog: [{ id: 'c1', name: '鶏むね肉', unit: 'g' }] }) }))
vi.mock('@/hooks/useIngredientAliases', () => ({ useIngredientAliases: () => ({ aliases: [{ alias: '鶏胸肉', catalog_id: 'c1', group_id: null }] }) }))
// 開いたときだけ、にんじん(冷蔵庫にまだない食材)を選ぶボタンを出す
vi.mock('@/components/IngredientPicker', () => ({
  IngredientPicker: ({ open, title, onSelect }) =>
    open ? (
      <button type="button" onClick={() => onSelect({ id: 'i9', name: 'にんじん', unit: '本', quantity: 0 })}>
        {title}: にんじん
      </button>
    ) : null,
}))
vi.mock('@/lib/recipeImport/client', () => ({ fetchRecipeFromUrl: vi.fn() }))
vi.mock('@/lib/recipeImport/save', () => ({ findDuplicate: vi.fn(), saveRecipe: vi.fn() }))

const URL_ = 'https://delishkitchen.tv/recipes/194135459369058708'

function renderPage() {
  render(
    <MemoryRouter>
      <RecipeNew groupId="g1" userId="u1" />
    </MemoryRouter>
  )
}

describe('レシピURLの取り込み', () => {
  beforeEach(() => {
    vi.mocked(findDuplicate).mockResolvedValue(null)
    vi.mocked(saveRecipe).mockResolvedValue({ recipeId: 'r1' })
    vi.mocked(fetchRecipeFromUrl).mockResolvedValue({
      recipe: { title: 'バンバンジー', servings: 2, yieldText: '2人分', url: URL_, sourceKey: 'delishkitchen:194135459369058708', site: 'DELISH KITCHEN', ingredients: ['＜タレ＞', '鶏むね肉 1枚(250g)', 'きゅうり 1本', '塩 少々'] },
    })
  })

  it('URLを貼って読み込むと、料理名と材料が入り、確認して保存できる', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('レシピのURL'), URL_)
    await userEvent.click(screen.getByRole('button', { name: '読み込む' }))
    expect(screen.getByLabelText('タイトル')).toHaveValue('バンバンジー')
    expect(screen.getByText(/3 件の材料を読み込みました/)).toBeInTheDocument()
    expect(screen.getByLabelText('鶏むね肉の分量')).toHaveValue('250')
    // 少々・適量も、元の表記のまま保存する(数は空)
    expect(screen.getByLabelText('塩を保存する')).toBeChecked()
    expect(screen.getByLabelText('塩の分量')).toHaveValue('')

    await userEvent.clear(screen.getByLabelText('きゅうりの分量'))
    await userEvent.type(screen.getByLabelText('きゅうりの分量'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'レシピ帳に保存' }))
    // 冷蔵庫にまだない材料(鶏むね肉・塩)は、家にあるか聞いてから保存する
    expect(screen.getByRole('dialog', { name: '家にある材料' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'この内容で保存' }))
    const args = vi.mocked(saveRecipe).mock.calls[0][0]
    expect(args).toMatchObject({ title: 'バンバンジー', url: URL_, sourceKey: 'delishkitchen:194135459369058708', sourceSite: 'DELISH KITCHEN', servings: 2 })
    expect(args.items.find((i) => i.name === 'きゅうり').requiredQuantity).toBe('2')
  })

  it('取り込んだレシピは、サイトの料理ジャンルと料理名からカテゴリを自動で付け、保存前に変えられる', async () => {
    vi.mocked(saveRecipe).mockClear()
    vi.mocked(fetchRecipeFromUrl).mockResolvedValue({
      recipe: { title: 'ピリ辛きゅうり', servings: 2, url: URL_, sourceKey: 'delishkitchen:1', site: 'DELISH KITCHEN', ingredients: ['きゅうり 1本'], cuisine: ['中華'] },
    })
    renderPage()
    await userEvent.type(screen.getByLabelText('レシピのURL'), URL_)
    await userEvent.click(screen.getByRole('button', { name: '読み込む' }))
    expect(screen.getByRole('radio', { name: /中華/ })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'レシピ帳に保存' }))
    expect(saveRecipe).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'chinese', categoryManual: false }))

    // 保存前に選び直すと、手動のカテゴリとして保存する
    await userEvent.click(screen.getByRole('radio', { name: /韓国料理/ }))
    await userEvent.click(screen.getByRole('button', { name: 'レシピ帳に保存' }))
    expect(saveRecipe).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'korean', categoryManual: true }))
  })

  it('すでに保存したレシピは読み込まずに知らせる', async () => {
    vi.mocked(findDuplicate).mockResolvedValue({ id: 'r9', title: 'バンバンジー' })
    renderPage()
    await userEvent.type(screen.getByLabelText('レシピのURL'), URL_)
    await userEvent.click(screen.getByRole('button', { name: '読み込む' }))
    const msg = screen.getByText(/すでに保存されています/)
    expect(within(msg).getByRole('link', { name: 'バンバンジー' })).toHaveAttribute('href', '/recipes/r9')
    expect(fetchRecipeFromUrl).not.toHaveBeenCalled()
  })

  it('読み込めない URL(IP アドレス・対応サイトのレシピ以外のページ)は、取得せずに手動登録に案内する', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('レシピのURL'), 'https://192.168.1.1/recipe/1')
    await userEvent.click(screen.getByRole('button', { name: '読み込む' }))
    expect(screen.getByText(/URLを残したまま、料理名と材料を下で入れて保存できます/)).toBeInTheDocument()
    expect(fetchRecipeFromUrl).not.toHaveBeenCalled()
  })

  it('対応サイト以外のページも読み込みを試し、読み込んだ後に重複を確かめる', async () => {
    vi.mocked(fetchRecipeFromUrl).mockResolvedValue({
      recipe: { title: '豚の生姜焼き', servings: 2, ingredients: ['豚ロース 200g'], url: 'https://blog.example.com/r/1', sourceKey: 'web:0123456789abcdef0123456789abcdef', site: 'blog.example.com', method: 'heuristic' },
    })
    renderPage()
    await userEvent.type(screen.getByLabelText('レシピのURL'), 'https://blog.example.com/r/1')
    expect(screen.getByText(/対応サイト以外のページです/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '読み込む' }))
    expect(fetchRecipeFromUrl).toHaveBeenCalledWith('https://blog.example.com/r/1')
    expect(findDuplicate).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'web:0123456789abcdef0123456789abcdef')
    expect(await screen.findByText(/「材料」の欄から 1 件を読み込みました。違う行があれば外してください/)).toBeInTheDocument()
  })

  it('読み込みに失敗したら理由を出し、手動で続けられる', async () => {
    vi.mocked(fetchRecipeFromUrl).mockResolvedValue({ error: 'このページから材料を読み取れませんでした。材料は下で手動で追加してください' })
    renderPage()
    await userEvent.type(screen.getByLabelText('レシピのURL'), URL_)
    await userEvent.click(screen.getByRole('button', { name: '読み込む' }))
    expect(screen.getByText(/読み取れませんでした/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '材料を選択' })).toBeInTheDocument()
  })
})

describe('自分で考えたレシピ', () => {
  beforeEach(() => {
    vi.mocked(saveRecipe).mockReset()
    vi.mocked(saveRecipe).mockResolvedValue({ recipeId: 'r9' })
  })

  it('URLなしで、料理名・作り方・メモ・人数・絵をつけて保存できる', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: '自分で考える' }))
    expect(screen.queryByLabelText('レシピのURL')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('料理名'), 'おばあちゃんの肉じゃが')
    await userEvent.click(screen.getByRole('radio', { name: '絵 🍲' }))
    await userEvent.type(screen.getByLabelText('何人分'), '4')
    await userEvent.type(screen.getByLabelText('手順1'), '具を切る')
    await userEvent.click(screen.getByRole('button', { name: '手順を追加' }))
    await userEvent.type(screen.getByLabelText('手順2'), '煮る')
    // 並べ替えもできる
    await userEvent.click(screen.getByRole('button', { name: '手順2を上へ' }))
    await userEvent.click(screen.getByRole('button', { name: '手順1を下へ' }))
    await userEvent.type(screen.getByLabelText('わが家のメモ'), '甘めに')
    await userEvent.click(screen.getByRole('button', { name: 'レシピ帳に保存' }))
    expect(saveRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'おばあちゃんの肉じゃが',
        url: null,
        sourceKey: null,
        extras: { icon: '🍲', servings: 4, instructions: null, memo: '甘めに' },
        steps: [expect.objectContaining({ text: '具を切る', uses: [] }), expect.objectContaining({ text: '煮る', uses: [] })],
      })
    )
  })
})

describe('保存のときの「家にある材料」', () => {
  beforeEach(() => {
    updates.length = 0
    supabase.rpc.mockClear()
    vi.mocked(findDuplicate).mockResolvedValue(null)
    vi.mocked(saveRecipe).mockResolvedValue({ recipeId: 'r1', ingredientIds: new Map() })
    vi.mocked(fetchRecipeFromUrl).mockResolvedValue({
      recipe: { title: 'バンバンジー', servings: 2, url: URL_, sourceKey: 'delishkitchen:1', site: 'DELISH KITCHEN', ingredients: ['鶏むね肉 250g', 'きゅうり 1本', 'しょうゆ 大さじ1'] },
    })
  })

  it('冷蔵庫にない材料だけ聞き、調味料は常備品・ほかは「ない」を選んでおく。選んだ材料を冷蔵庫と常備品に入れる', async () => {
    renderPage()
    await userEvent.type(screen.getByLabelText('レシピのURL'), URL_)
    await userEvent.click(screen.getByRole('button', { name: '読み込む' }))
    await userEvent.click(screen.getByRole('button', { name: 'レシピ帳に保存' }))
    const dialog = screen.getByRole('dialog', { name: '家にある材料' })
    // きゅうりは冷蔵庫にあるので聞かない
    expect(within(dialog).queryByText('きゅうり')).not.toBeInTheDocument()
    const chicken = within(dialog).getByRole('radiogroup', { name: '鶏むね肉は家にあるか' })
    const soy = within(dialog).getByRole('radiogroup', { name: 'しょうゆは家にあるか' })
    expect(within(chicken).getByRole('radio', { name: 'ない' })).toHaveAttribute('aria-checked', 'true')
    expect(within(soy).getByRole('radio', { name: '常備品' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(chicken).getByRole('radio', { name: '家にある' }))
    expect(within(dialog).getByLabelText('鶏むね肉の今ある量')).toHaveValue('250')
    await userEvent.clear(within(dialog).getByLabelText('鶏むね肉の今ある量'))
    await userEvent.type(within(dialog).getByLabelText('鶏むね肉の今ある量'), '300')

    // 保存先の食材 ID(saveRecipe の結果)で冷蔵庫・常備品に入れる
    const items = () => vi.mocked(saveRecipe).mock.calls.at(-1)[0].items
    vi.mocked(saveRecipe).mockImplementation(async (args) => ({
      recipeId: 'r1',
      ingredientIds: new Map(args.items.map((i) => [i.key, i.name === '鶏むね肉' ? 'id-chicken' : i.name === 'しょうゆ' ? 'id-soy' : 'id-x'])),
    }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'この内容で保存' }))
    expect(items().length).toBeGreaterThan(0)
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_stock', { p_ingredient_id: 'id-chicken', p_delta: 300, p_dated_today: true, p_best_before: null, p_use_by: null })
    expect(updates).toEqual([{ patch: { is_staple: true }, col: 'id', ids: ['id-soy'] }])
  })

  it('「戻る」で編集に戻れる(保存しない)', async () => {
    vi.mocked(saveRecipe).mockClear()
    renderPage()
    await userEvent.type(screen.getByLabelText('レシピのURL'), URL_)
    await userEvent.click(screen.getByRole('button', { name: '読み込む' }))
    await userEvent.click(screen.getByRole('button', { name: 'レシピ帳に保存' }))
    await userEvent.click(screen.getByRole('button', { name: '戻る' }))
    expect(screen.queryByRole('dialog', { name: '家にある材料' })).not.toBeInTheDocument()
    expect(saveRecipe).not.toHaveBeenCalled()
  })
})

describe('作り方から材料を足す', () => {
  beforeEach(() => {
    updates.length = 0
    supabase.rpc.mockClear()
    vi.mocked(saveRecipe).mockImplementation(async (args) => ({ recipeId: 'r1', ingredientIds: new Map(args.items.map((i) => [i.key, i.ingredient?.id ?? 'id-x'])) }))
  })

  it('手順で上の材料にない食材を選ぶと、上の材料と手順に入り、保存時の「家にある材料」にも出る', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: '自分で考える' }))
    await userEvent.type(screen.getByLabelText('料理名'), 'にんじんしりしり')
    await userEvent.type(screen.getByLabelText('手順1'), 'にんじんを細切りにする')
    await userEvent.selectOptions(screen.getByLabelText('手順1で使う材料を追加'), '__new__')
    await userEvent.click(screen.getByRole('button', { name: '手順で使う材料を選ぶ: にんじん' }))
    // 上の材料に入る
    expect(screen.getByLabelText('にんじんの分量')).toBeInTheDocument()
    // この手順で使う材料にもなり、量を入れると上の分量にすぐ反映する
    await userEvent.type(screen.getByLabelText('手順1のにんじんの量'), '2')
    expect(screen.getByLabelText('にんじんの分量')).toHaveValue('2')
    // 2つ目の手順では、上の材料として選べる(重ねて足さない)
    await userEvent.click(screen.getByRole('button', { name: '手順を追加' }))
    await userEvent.selectOptions(screen.getByLabelText('手順2で使う材料を追加'), 'にんじん')
    expect(screen.getAllByLabelText('にんじんの分量')).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: 'レシピ帳に保存' }))
    const dialog = screen.getByRole('dialog', { name: '家にある材料' })
    const carrot = within(dialog).getByRole('radiogroup', { name: 'にんじんは家にあるか' })
    await userEvent.click(within(carrot).getByRole('radio', { name: '家にある' }))
    await userEvent.clear(within(dialog).getByLabelText('にんじんの今ある量'))
    await userEvent.type(within(dialog).getByLabelText('にんじんの今ある量'), '3')
    await userEvent.click(within(dialog).getByRole('button', { name: 'この内容で保存' }))
    const saved = vi.mocked(saveRecipe).mock.calls.at(-1)[0]
    expect(saved.items).toEqual([expect.objectContaining({ name: 'にんじん', requiredQuantity: '2' })])
    expect(saved.steps[0].uses).toEqual([expect.objectContaining({ quantity: '2' })])
    expect(supabase.rpc).toHaveBeenCalledWith('adjust_stock', { p_ingredient_id: 'i9', p_delta: 3, p_dated_today: true, p_best_before: null, p_use_by: null })
  })
})
