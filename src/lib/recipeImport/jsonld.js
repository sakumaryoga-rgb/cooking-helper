// ページの JSON-LD から Recipe を探し、料理名・人数・材料だけを取り出す(手順・画像・説明文は取り出さない)
const MAX_TITLE = 200
const MAX_LINE = 200
const MAX_LINES = 80

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export function decodeEntities(text) {
  return String(text)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m)
}

function clean(text, max) {
  return decodeEntities(text).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function isRecipe(node) {
  const t = node?.['@type']
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))
}

function findRecipe(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 5) return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipe(item, depth + 1)
      if (found) return found
    }
    return null
  }
  if (isRecipe(node)) return node
  if (node['@graph']) return findRecipe(node['@graph'], depth + 1)
  if (node.mainEntity) return findRecipe(node.mainEntity, depth + 1)
  return null
}

export function parseServings(recipeYield) {
  const text = Array.isArray(recipeYield) ? recipeYield.join(' ') : String(recipeYield ?? '')
  const m = text.normalize('NFKC').match(/(\d+(?:\.\d+)?)/)
  if (!m) return null
  const n = Math.round(Number(m[1]))
  return n >= 1 && n <= 100 ? n : null
}

export function extractRecipe(html) {
  const blocks = String(html).matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)
  for (const [, body] of blocks) {
    let data
    try {
      data = JSON.parse(body.trim())
    } catch {
      continue
    }
    const recipe = findRecipe(data)
    if (!recipe) continue
    const title = clean(recipe.name ?? recipe.headline ?? '', MAX_TITLE)
    const rawIngredients = Array.isArray(recipe.recipeIngredient)
      ? recipe.recipeIngredient
      : Array.isArray(recipe.ingredients)
        ? recipe.ingredients
        : []
    const ingredients = rawIngredients
      .filter((line) => typeof line === 'string')
      .map((line) => clean(line, MAX_LINE))
      .filter(Boolean)
      .slice(0, MAX_LINES)
    if (!title && ingredients.length === 0) continue
    const yieldText = clean(Array.isArray(recipe.recipeYield) ? recipe.recipeYield.join(' ') : recipe.recipeYield ?? '', 40)
    return { title, servings: parseServings(recipe.recipeYield), yieldText, ingredients }
  }
  return null
}
