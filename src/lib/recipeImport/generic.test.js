import { describe, expect, it } from 'vitest'
import { extractAnyRecipe, extractHeuristic, pageFeatures, pageTitle, robotsAllows } from './generic'
import { genericSourceKey, isPublicHostname, parseGenericUrl, parseImportUrl } from './sites'

describe('汎用の読み取り: 材料の見出しの直後の一覧', () => {
  it('「材料(2人分)」の見出しの後の一覧を材料として読む。題名はサイト名を外す', () => {
    const html = `<title>豚の生姜焼き | わが家の台所</title><h2>材料(2人分)</h2><ul><li>豚ロース 200g</li><li>しょうが 1かけ</li><li>しょうゆ 大さじ2</li></ul><h2>作り方</h2><ol><li>秘密</li></ol>`
    expect(extractHeuristic(html)).toMatchObject({ title: '豚の生姜焼き', servings: 2, ingredients: ['豚ロース 200g', 'しょうが 1かけ', 'しょうゆ 大さじ2'] })
    expect(JSON.stringify(extractHeuristic(html))).not.toContain('秘密')
  })

  it('表(table)と dl の形も読む', () => {
    expect(extractHeuristic('<h3>材料</h3><table><tr><td>卵</td><td>2個</td></tr><tr><td>砂糖</td><td>大さじ1</td></tr></table>').ingredients).toEqual(['卵 2個', '砂糖 大さじ1'])
    expect(extractHeuristic('<p>材料</p><dl><dt>鶏もも肉</dt><dd>1枚</dd><dt>塩</dt><dd>少々</dd></dl>').ingredients).toEqual(['鶏もも肉 1枚', '塩 少々'])
  })

  it('材料らしくない一覧(メニューなど)は材料にしない', () => {
    expect(extractHeuristic('<h2>材料の選び方</h2><ul><li>ホーム</li><li>お問い合わせ</li><li>プロフィール</li></ul>')).toBeNull()
  })

  it('JSON-LD に材料があればそれを使い、なければ microdata・見出しの順に試す', () => {
    const ld = `<script type="application/ld+json">{"@type":"Recipe","name":"A","recipeIngredient":["卵 1個"]}</script>`
    expect(extractAnyRecipe(ld).method).toBe('jsonld')
    const ldNoIngredients = `<script type="application/ld+json">{"@type":"Recipe","name":"親子丼"}</script><h2>材料</h2><ul><li>卵 2個</li><li>鶏肉 100g</li></ul>`
    expect(extractAnyRecipe(ldNoIngredients)).toMatchObject({ method: 'heuristic', recipe: { title: '親子丼' } })
    expect(extractAnyRecipe('<p>レシピはありません</p>')).toBeNull()
  })

  it('og:title を題名に使う', () => {
    expect(pageTitle('<meta property="og:title" content="カレー | ブログ"><title>x</title>')).toBe('カレー')
  })
})

describe('読み取れなかったページの特徴', () => {
  it('JSON-LD の種類・材料のない Recipe・JavaScript で描くページの手がかりを返し、本文は含めない', () => {
    const f = pageFeatures(`<meta name="generator" content="WordPress 6.6"><script type="application/ld+json">[{"@type":"WebPage"},{"@type":"Recipe","name":"x"}]</script><script type="application/ld+json">{bad</script><div id="__next"></div><p>秘密の本文</p>`)
    expect(f).toMatchObject({ ld_blocks: 2, ld_parse_errors: 1, ld_types: ['WebPage', 'Recipe'], ld_recipe_without_ingredients: true, generator: 'WordPress 6.6', spa_hint: true })
    expect(JSON.stringify(f)).not.toContain('秘密')
  })
})

describe('robots.txt', () => {
  it('* の規則と、COOKDOOR 向けの規則(あれば優先)を使う。長い規則・Allow を優先する', () => {
    const txt = 'User-agent: *\nDisallow: /admin/\nDisallow: /recipes/\nAllow: /recipes/public/\n\nUser-agent: Googlebot\nDisallow: /'
    expect(robotsAllows(txt, '/recipes/1')).toBe(false)
    expect(robotsAllows(txt, '/recipes/public/1')).toBe(true)
    expect(robotsAllows(txt, '/blog/1')).toBe(true)
    expect(robotsAllows('User-agent: COOKDOOR\nDisallow: /\n\nUser-agent: *\nDisallow:', '/a')).toBe(false)
    expect(robotsAllows('User-agent: *\nDisallow: /*.php$', '/a.php')).toBe(false)
    expect(robotsAllows('User-agent: *\nDisallow: /*.php$', '/a.php?x=1')).toBe(true)
    expect(robotsAllows('', '/a')).toBe(true)
  })
})

describe('汎用の読み取りの URL', () => {
  it('公開ドメインの http(s) を https に直し、追跡用のパラメータと # を外す', () => {
    expect(parseGenericUrl('http://Blog.Example.com/r/1?utm_source=x&id=3#top')).toMatchObject({ url: 'https://blog.example.com/r/1?id=3', generic: true, site: { id: 'generic', name: 'blog.example.com' } })
  })

  it('IP アドレス・社内向けの名前・別のポート・ユーザー情報は使わない', () => {
    for (const host of ['127.0.0.1', '10.0.0.1', '0x7f000001', '2130706433', 'localhost', 'router.lan', 'a.internal', 'nas.local', 'intranet']) {
      expect(isPublicHostname(host)).toBe(false)
    }
    expect(isPublicHostname('recipe.example.co.jp')).toBe(true)
    expect(parseGenericUrl('https://a.example.com:8080/x')).toBeNull()
    expect(parseGenericUrl('https://u:p@a.example.com/x')).toBeNull()
    expect(parseGenericUrl('javascript:alert(1)')).toBeNull()
  })

  it('対応サイトのドメインで、レシピのページでない URL は読み込まない', () => {
    expect(parseImportUrl('https://www.kurashiru.com/articles/1')).toBeNull()
    expect(parseImportUrl('https://www.kurashiru.com/recipes/0b0e6c4e-1111-4222-8333-444455556666').site.id).toBe('kurashiru')
    expect(parseImportUrl('https://cookpad.com/recipe/1').generic).toBe(true)
  })

  it('重複を見分けるキーは URL ごとに決まり、レシピのキーの形に合う', async () => {
    const a = await genericSourceKey('https://blog.example.com/r/1')
    expect(a).toMatch(/^web:[0-9a-f]{32}$/)
    expect(await genericSourceKey('https://blog.example.com/r/1')).toBe(a)
    expect(await genericSourceKey('https://blog.example.com/r/2')).not.toBe(a)
  })
})
