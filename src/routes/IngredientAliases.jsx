import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Search, X } from 'lucide-react'
import { supabase } from '@/supabaseClient'
import { useIngredientCatalog } from '@/hooks/useIngredientCatalog'
import { useIngredientAliases } from '@/hooks/useIngredientAliases'
import { nameKey } from '@/lib/ingredientName'
import { Input } from '@/components/ui/input'

// 覚えた食材の別名(設定から開く別ページ。タブには出さない)。
// レシピの取り込みで付け替えたときに覚えた表記。件数が多くなるので、食材ごとにまとめて検索できるようにする。誤って覚えたものは消せる
export function IngredientAliases({ groupId }) {
  const { catalog } = useIngredientCatalog()
  const { aliases, refresh } = useIngredientAliases()
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busyAlias, setBusyAlias] = useState(null)

  // 開いたときに読み直す(取り込みで覚えた別名や、家族が別の端末で覚えた別名を出す)
  useEffect(() => {
    refresh?.()
  }, [refresh])

  const own = useMemo(() => (aliases ?? []).filter((a) => a.group_id === groupId), [aliases, groupId])
  const groups = useMemo(() => {
    const nameOf = (id) => catalog.find((c) => c.id === id)?.name ?? '(不明)'
    const q = nameKey(query)
    const byFood = new Map()
    for (const a of own) {
      const food = nameOf(a.catalog_id)
      if (q && !nameKey(a.alias).includes(q) && !nameKey(food).includes(q)) continue
      if (!byFood.has(a.catalog_id)) byFood.set(a.catalog_id, { id: a.catalog_id, food, aliases: [] })
      byFood.get(a.catalog_id).aliases.push(a.alias)
    }
    return [...byFood.values()]
      .map((g) => ({ ...g, aliases: g.aliases.sort((x, y) => x.localeCompare(y, 'ja')) }))
      .sort((x, y) => x.food.localeCompare(y.food, 'ja'))
  }, [own, catalog, query])

  async function forget(alias) {
    setError('')
    setBusyAlias(alias)
    const { error: deleteError } = await supabase.from('ingredient_aliases').delete().eq('group_id', groupId).eq('alias', alias)
    setBusyAlias(null)
    if (deleteError) {
      setError('別名を消せませんでした')
      return
    }
    await refresh?.()
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to="/settings" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        設定
      </Link>
      <div>
        <h1 className="text-lg font-medium">覚えた食材の別名</h1>
        <p className="text-sm text-muted-foreground">
          レシピの取り込みで選んだ表記です。この家だけで使い、次から自動でその食材になります。間違って覚えたものは「忘れる」で消せます
        </p>
      </div>

      {own.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          まだ覚えた別名はありません。レシピの取り込みで材料を別の食材に付け替えると、ここに記録されます
        </p>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="別名・食材名で探す"
              aria-label="別名を探す"
              className="pl-9 text-base"
            />
          </div>
          <p className="text-xs text-muted-foreground">{own.length}件</p>
          {groups.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground">「{query}」に当てはまる別名はありません</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border rounded-lg border bg-card">
              {groups.map((g) => (
                <li key={g.id} className="flex flex-col gap-2 px-3 py-2.5">
                  <span className="text-sm font-medium">{g.food}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {g.aliases.map((alias) => (
                      <span key={alias} className="inline-flex items-center gap-1 rounded-full border bg-background py-0.5 pl-2.5 pr-1 text-xs">
                        {alias}
                        <button
                          type="button"
                          className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                          onClick={() => forget(alias)}
                          disabled={busyAlias === alias}
                          aria-label={`「${alias}」を忘れる`}
                        >
                          <X className="size-3" />
                          忘れる
                        </button>
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
