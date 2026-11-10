// 対応サイト以外のページ(汎用の読み取り)から、料理名・人数・材料だけを取り出す(手順・画像・説明文は取り出さない)
// 読み取りの順: 1. JSON-LD(schema.org/Recipe) 2. microdata(itemtype=schema.org/Recipe) 3. 「材料」の見出しの直後の一覧
// 読み取れなかったときは pageFeatures でページの特徴(本文は含めない)を返し、失敗の記録に使う。
// このファイルは Vercel Function(api/recipe-import.js)からも使うため、'@/' の別名を使わない
import { decodeEntities, extractRecipe, parseServings } from './jsonld.js'

const MAX_TITLE = 200
const MAX_LINE = 200
const MAX_LINES = 80

function clean(text, max) {
  return decodeEntities(String(text ?? ''))
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : null
}

function metaContent(html, key) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const k = (attr(tag, 'property') ?? attr(tag, 'name') ?? '').toLowerCase()
    if (k === key) return attr(tag, 'content')
  }
  return null
}

// ページの題名(og:title → <title>)。「| サイト名」などの後ろは外す
export function pageTitle(html) {
  const og = metaContent(html, 'og:title')
  const t = og ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''
  return clean(t, MAX_TITLE).split(/\s+[|｜\-–—]\s+/)[0].trim()
}

// ------------------------------------------------------------
// microdata
// ------------------------------------------------------------
function itempropValues(html, names) {
  const out = []
  const re = new RegExp(`<([a-z][a-z0-9]*)\\b([^>]*\\sitemprop\\s*=\\s*["']?(?:${names.join('|')})["']?[^>]*)>`, 'gi')
  let m
  while ((m = re.exec(html)) && out.length < MAX_LINES) {
    const [whole, tagName, attrs] = m
    const content = attr(` ${attrs}`, 'content')
    if (content != null) {
      out.push(clean(content, MAX_LINE))
      continue
    }
    if (/^(meta|link|img|br|input)$/i.test(tagName)) continue
    const close = new RegExp(`</${tagName}\\s*>`, 'i')
    const rest = html.slice(m.index + whole.length)
    const end = rest.search(close)
    if (end >= 0) out.push(clean(rest.slice(0, Math.min(end, 2000)), MAX_LINE))
  }
  return out.filter(Boolean)
}

export function extractMicrodata(html) {
  const text = String(html)
  const start = text.search(/itemtype\s*=\s*["']?https?:\/\/schema\.org\/Recipe["'\s>]/i)
  if (start < 0) return null
  const scope = text.slice(start)
  const ingredients = itempropValues(scope, ['recipeIngredient', 'ingredients']).slice(0, MAX_LINES)
  if (ingredients.length === 0) return null
  const name = itempropValues(scope, ['name'])[0] ?? ''
  const yieldText = itempropValues(scope, ['recipeYield'])[0] ?? ''
  return {
    title: name || pageTitle(text),
    servings: parseServings(yieldText),
    yieldText: yieldText.slice(0, 40),
    ingredients,
    cuisine: [],
    categories: [],
    keywords: [],
  }
}

// ------------------------------------------------------------
// 「材料」の見出しの直後の一覧(構造化データのないブログなど)
// 材料らしい行(分量・単位・少々など)が半分以上の一覧だけを使う(料理以外の一覧を材料にしない)
// ------------------------------------------------------------
const HEADING = /<(h[1-6]|dt|p|div|span|strong|b|th|caption)\b[^>]*>(?:\s|<[^>]+>)*(材料|ざいりょう|Ingredients?)([^<]{0,30})/gi
const AMOUNT_LIKE = /\d|[０-９一二三四五六七八九十半]|少々|適量|適宜|大さじ|小さじ|カップ|ひとつまみ|お好み|個|本|枚|g\b|ml\b|cc\b|片|かけ|束|袋|パック|玉|房|株|切れ|丁|合/i

function listItems(fragment) {
  const kind = fragment.match(/^<(ul|ol|table|dl)\b/i)?.[1]?.toLowerCase()
  if (kind === 'ul' || kind === 'ol') return [...fragment.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => clean(m[1], MAX_LINE))
  if (kind === 'table') {
    return [...fragment.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
      [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => clean(c[1], 100)).filter(Boolean).join(' ')
    )
  }
  if (kind === 'dl') {
    const terms = [...fragment.matchAll(/<(dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    const rows = []
    for (let i = 0; i < terms.length; i++) {
      if (terms[i][1].toLowerCase() !== 'dt') continue
      const dd = terms[i + 1]?.[1].toLowerCase() === 'dd' ? clean(terms[i + 1][2], 60) : ''
      rows.push(`${clean(terms[i][2], 100)} ${dd}`.trim())
    }
    return rows
  }
  return []
}

export function extractHeuristic(html) {
  const text = String(html)
  for (const m of text.matchAll(HEADING)) {
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 6000)
    const listStart = after.search(/<(ul|ol|table|dl)\b/i)
    if (listStart < 0 || listStart > 1500) continue
    const fragment = after.slice(listStart)
    const kind = fragment.match(/^<(ul|ol|table|dl)\b/i)[1]
    const end = fragment.search(new RegExp(`</${kind}\\s*>`, 'i'))
    if (end < 0) continue
    const items = listItems(fragment.slice(0, end + kind.length + 3))
      .map((s) => s.replace(/^[・●○■□◆◇★☆\-*]\s*/, ''))
      .filter((s) => s && s.length <= 80)
    if (items.length < 2 || items.length > 60) continue
    if (items.filter((s) => AMOUNT_LIKE.test(s)).length * 2 < items.length) continue
    return {
      title: pageTitle(text),
      servings: parseServings(m[3] ?? ''),
      yieldText: clean(m[3] ?? '', 40).replace(/^[(（]|[)）]$/g, ''),
      ingredients: items.slice(0, MAX_LINES),
      cuisine: [],
      categories: [],
      keywords: [],
    }
  }
  return null
}

// 1 → 2 → 3 の順に読み取る。{ recipe, method } か null
export function extractAnyRecipe(html) {
  const ld = extractRecipe(html)
  if (ld && ld.ingredients.length > 0) return { recipe: ld, method: 'jsonld' }
  const micro = extractMicrodata(html)
  if (micro) return { recipe: { ...micro, title: micro.title || ld?.title || '' }, method: 'microdata' }
  const guess = extractHeuristic(html)
  if (guess) return { recipe: { ...guess, title: ld?.title || guess.title }, method: 'heuristic' }
  return null
}

// 読み取れなかったページの特徴(失敗の記録に残す。本文・材料・画像は含めない)
export function pageFeatures(html) {
  const text = String(html)
  const types = new Set()
  let blocks = 0
  let parseErrors = 0
  let recipeWithoutIngredients = false
  const collect = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 6 || types.size >= 12) return
    if (Array.isArray(node)) return node.forEach((n) => collect(n, depth + 1))
    const t = node['@type']
    for (const v of Array.isArray(t) ? t : [t]) if (typeof v === 'string') types.add(v.slice(0, 40))
    if ((t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) && !Array.isArray(node.recipeIngredient) && !Array.isArray(node.ingredients)) recipeWithoutIngredients = true
    if (node['@graph']) collect(node['@graph'], depth + 1)
    if (node.mainEntity) collect(node.mainEntity, depth + 1)
  }
  for (const [, body] of text.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    blocks += 1
    try {
      collect(JSON.parse(body.trim()))
    } catch {
      parseErrors += 1
    }
  }
  const generator = metaContent(text, 'generator')
  return {
    bytes: text.length,
    ld_blocks: blocks,
    ld_parse_errors: parseErrors,
    ld_types: [...types].slice(0, 12),
    ld_recipe_without_ingredients: recipeWithoutIngredients,
    microdata_recipe: /itemtype\s*=\s*["']?https?:\/\/schema\.org\/Recipe/i.test(text),
    itemprop_ingredient: /itemprop\s*=\s*["']?(recipeIngredient|ingredients)/i.test(text),
    ingredient_heading: /(材料|ざいりょう|Ingredients?)/i.test(text.replace(/<script[\s\S]*?<\/script>/gi, '')),
    og_type: (metaContent(text, 'og:type') ?? '').slice(0, 30) || null,
    generator: generator ? generator.slice(0, 40) : null,
    // JavaScript で材料を後から出すページ(取得した HTML には材料がない)
    spa_hint: /<div[^>]+id=["'](?:__next|root|app|__nuxt)["'][^>]*>\s*<\/div>/i.test(text),
  }
}

// ------------------------------------------------------------
// robots.txt(汎用の読み取りでは、禁止されたページは取得しない)
// ------------------------------------------------------------
export function robotsAllows(robotsText, path, agent = 'cookdoor') {
  const groups = []
  let current = null
  let lastWasAgent = false
  for (const raw of String(robotsText ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i)
    if (!m) continue
    const key = m[1].toLowerCase()
    const value = m[2].trim()
    if (key === 'user-agent') {
      if (!lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }
    lastWasAgent = false
    if (!current) continue
    if (key === 'allow' || key === 'disallow') current.rules.push({ allow: key === 'allow', pattern: value })
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && agent.includes(a)))
  const chosen = mine.length > 0 ? mine : groups.filter((g) => g.agents.includes('*'))
  let best = null
  for (const rule of chosen.flatMap((g) => g.rules)) {
    if (!rule.pattern) continue // 「Disallow:」(空)はすべて許可
    const anchored = rule.pattern.endsWith('$')
    const body = (anchored ? rule.pattern.slice(0, -1) : rule.pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    if (!new RegExp(`^${body}${anchored ? '$' : ''}`).test(path)) continue
    // いちばん長い規則を使う。同じ長さなら Allow を優先
    if (!best || rule.pattern.length > best.pattern.length || (rule.pattern.length === best.pattern.length && rule.allow)) best = rule
  }
  return best ? best.allow : true
}
