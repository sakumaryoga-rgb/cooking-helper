import { supabase } from '@/supabaseClient'
import { SUPPORTED_SITES } from '@/lib/recipeImport/sites'

const MESSAGES = {
  unsupported_url: `このURLからは材料を読み込めません。レシピのページのURL(https://〜)を貼ってください(対応サイト: ${SUPPORTED_SITES.map((s) => s.name).join('、')})`,
  no_recipe_data: 'このページからレシピの材料を読み取れませんでした(レシピ以外の記事のページかもしれません)。読み取れなかったページの形は記録して、読み込みの改善に使います',
  robots_disallowed: 'このサイトは、ページの自動での読み込みを許可していません',
  fetch_failed: 'レシピのページを開けませんでした。時間をおいてもう一度お試しください',
  unauthorized: 'ログインし直してから、もう一度お試しください',
  not_configured: 'この環境ではURLからの読み込みを使えません。材料を手動で追加してください',
  rate_limited: 'URLからの読み込みが続いたため、少し時間をおいてからお試しください(1時間に30回まで)。材料は手動でも追加できます',
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
