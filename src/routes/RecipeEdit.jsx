import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { supabase } from '@/supabaseClient'
import { useIngredients } from '@/hooks/useIngredients'
import { useRecipes } from '@/hooks/useRecipes'
import { RecipeItemsEditor, keyOf } from '@/components/RecipeItemsEditor'
import { RecipeExtrasFields, normalizeExtras } from '@/components/RecipeExtrasFields'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateRecipe } from '@/lib/recipeImport/save'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

// 保存したレシピを自分好みに変える(料理名・材料と分量・人数・作り方・メモ・絵)
export function RecipeEdit({ groupId }) {
  const { id } = useParams()
  const { recipes, loading } = useRecipes(groupId)
  const { ingredients } = useIngredients(groupId)
  const recipe = recipes.find((r) => r.id === id)
  if (loading) return <p className="text-sm text-muted-foreground">読み込み中...</p>
  if (!recipe) return <p className="text-sm text-muted-foreground">レシピが見つかりません</p>
  return <RecipeEditForm key={recipe.id} recipe={recipe} groupId={groupId} ingredients={ingredients} />
}

function RecipeEditForm({ recipe, groupId, ingredients }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(recipe.title)
  const [items, setItems] = useState(() =>
    (recipe.recipe_ingredients ?? []).map((ri) => {
      const ingredient = ingredients.find((i) => i.id === ri.ingredient_id) ?? ri.ingredient ?? { id: ri.ingredient_id, name: '(不明な食材)', unit: '' }
      return {
        key: keyOf(),
        kind: 'existing',
        ingredient,
        name: ingredient.name,
        unit: ingredient.unit,
        requiredQuantity: ri.required_quantity,
        rawText: ri.raw_text ?? undefined,
        include: true,
        needsCheck: false,
      }
    })
  )
  const [extras, setExtras] = useState({
    icon: recipe.icon ?? '',
    servings: recipe.servings ? String(recipe.servings) : '',
    instructions: recipe.instructions ?? '',
    memo: recipe.memo ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // レシピを削除する(材料の行も消える。冷蔵庫の食材と、作った記録の在庫の履歴は残る)
  async function handleDelete() {
    setDeleting(true)
    setError('')
    const { data, error: deleteError } = await supabase.from('recipes').delete().eq('id', recipe.id).select('id')
    setDeleting(false)
    setConfirmDelete(false)
    if (deleteError || !data?.length) {
      setError('レシピを削除できませんでした。選んでいる家のレシピか確かめてください')
      return
    }
    navigate('/recipes', { replace: true })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSaving(true)
    const result = await updateRecipe({
      supabase,
      groupId,
      recipeId: recipe.id,
      title,
      items,
      fridge: ingredients,
      extras: normalizeExtras(extras),
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    navigate(`/recipes/${recipe.id}`, { replace: true })
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to={`/recipes/${recipe.id}`} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        レシピに戻る
      </Link>
      <h1 className="text-xl font-bold">レシピをカスタマイズ</h1>
      {recipe.url && (
        <p className="rounded-2xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          取り込んだレシピも、分量や材料をわが家用に変えられます。元のページへのリンクはそのまま残ります
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recipe-title">料理名</Label>
          <Input id="recipe-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
        </div>

        <RecipeItemsEditor
          groupId={groupId}
          ingredients={ingredients}
          items={items}
          setItems={setItems}
          emptyText="材料がありません。「材料を選択」から追加してください"
        />

        <RecipeExtrasFields value={extras} onChange={(patch) => setExtras((prev) => ({ ...prev, ...patch }))} />

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={() => navigate(`/recipes/${recipe.id}`)}>
            やめる
          </Button>
          <Button type="submit" className="flex-1" disabled={saving}>
            {saving ? '保存中...' : '保存する'}
          </Button>
        </div>
      </form>

      <div className="mt-4 border-t pt-4">
        <Button type="button" variant="destructive" className="w-full" onClick={() => setConfirmDelete(true)} disabled={deleting}>
          <Trash2 className="size-4" />
          このレシピを削除
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={(open) => !open && setConfirmDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>「{recipe.title}」を削除しますか?</AlertDialogTitle>
            <AlertDialogDescription>
              家族全員のレシピ一覧から消え、元に戻せません。冷蔵庫の食材はそのまま残ります。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              やめる
            </Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? '削除中...' : '削除する'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
