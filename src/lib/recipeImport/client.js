import { supabase } from '@/supabaseClient'

const MESSAGES = {
  unsupported_url: 'このURLからは材料を読み込めません。クラシル、DELISH KITCHEN、Nadia のレシピページのURLを貼ってください',
  no_recipe_data: 'このページから材料を読み取れませんでした。材料は下で手動で追加してください',
  fetch_failed: 'レシピのページを開けませんでした。時間をおいて試すか、材料を手動で追加してください',
  unauthorized: 'ログインし直してから、もう一度お試しください',
  not_configured: 'この環境ではURLからの読み込みを使えません。材料を手動で追加してください',
}

// サーバー(Vercel Function)に URL を渡し、料理名・人数・材料の文字列を受け取る
export async function fetchRecipeFromUrl(url) {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (!token) return { error: MESSAGES.unauthorized }
    const res = await fetch('/api/recipe-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { error: MESSAGES[body.error] ?? MESSAGES.fetch_failed }
    return { recipe: body }
  } catch {
    return { error: MESSAGES.fetch_failed }
  }
}
