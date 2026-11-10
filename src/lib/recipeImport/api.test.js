import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../../api/recipe-import.js'
import { safeFetch } from '../../../api/_lib/safeFetch.js'

// 汎用の読み取りの取得は、ネットワークに出ずに差し替える
vi.mock('../../../api/_lib/safeFetch.js', () => ({ safeFetch: vi.fn() }))

function call(body, headers = { authorization: 'Bearer good.token.x' }) {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
  return handler({ method: 'POST', headers, body }, res).then(() => ({ status: res.statusCode, json: JSON.parse(res.body) }))
}

const page = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'バンバンジー', recipeYield: '2人分', recipeIngredient: ['鶏むね肉 1枚(250g)'], recipeInstructions: ['秘密の手順'] })}</script>`

beforeEach(() => {
  safeFetch.mockReset()
  safeFetch.mockResolvedValue({ error: 'fetch_status', status: 404 })
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const u = String(url)
      if (u.endsWith('/auth/v1/user')) return new Response('{}', { status: 200 })
      if (u.endsWith('/rest/v1/recipe_import_runs')) return new Response(null, { status: 201 })
      if (u === 'https://delishkitchen.tv/recipes/194135459369058708') return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      if (u === 'https://oceans-nadia.com/user/1/recipe/2') return new Response('', { status: 302, headers: { location: 'https://evil.example/' } })
      return new Response('not found', { status: 404 })
    })
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('/api/recipe-import', () => {
  it('対応サイトのレシピから料理名・人数・材料だけを返す', async () => {
    const { status, json } = await call({ url: 'https://delishkitchen.tv/recipes/194135459369058708?x=1' })
    expect(status).toBe(200)
    expect(json).toMatchObject({ title: 'バンバンジー', servings: 2, ingredients: ['鶏むね肉 1枚(250g)'], sourceKey: 'delishkitchen:194135459369058708', site: 'DELISH KITCHEN' })
    expect(JSON.stringify(json)).not.toContain('秘密の手順')
    // 成功を利用者の権限で記録する(サイトと結果だけ)
    const record = fetch.mock.calls.find(([url]) => String(url).endsWith('/rest/v1/recipe_import_runs'))
    expect(record[1].headers.Authorization).toBe('Bearer good.token.x')
    expect(JSON.parse(record[1].body)).toEqual({ site: 'delishkitchen', outcome: 'success', method: 'jsonld' })
  })

  it('取得に失敗した取り込みも記録する', async () => {
    await call({ url: 'https://oceans-nadia.com/user/1/recipe/2' })
    const record = fetch.mock.calls.find(([url]) => String(url).endsWith('/rest/v1/recipe_import_runs'))
    expect(JSON.parse(record[1].body)).toEqual({ site: 'nadia', outcome: 'fetch_failed' })
  })

  it('ログインしていなければ取得しない', async () => {
    fetch.mockImplementationOnce(async () => new Response('{}', { status: 401 }))
    expect((await call({ url: 'https://delishkitchen.tv/recipes/194135459369058708' })).status).toBe(401)
    expect((await call({ url: 'https://delishkitchen.tv/recipes/194135459369058708' }, {})).status).toBe(401)
  })

  it('対応サイト以外の URL と、他のホストへのリダイレクトはたどらない', async () => {
    expect((await call({ url: 'http://169.254.169.254/latest/meta-data' })).json.error).toBe('unsupported_url')
    expect((await call({ url: 'https://www.kurashiru.com/articles/1' })).status).toBe(422)
    const redirected = await call({ url: 'https://oceans-nadia.com/user/1/recipe/2' })
    expect(redirected).toMatchObject({ status: 502, json: { reason: 'redirect' } })
    expect(fetch).not.toHaveBeenCalledWith('https://evil.example/', expect.anything())
  })

  it('接続情報がない環境では使えない', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    expect((await call({ url: 'https://delishkitchen.tv/recipes/194135459369058708' })).status).toBe(503)
  })

  it('Vercel の Preview では本番の Supabase に問い合わせない', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    expect((await call({ url: 'https://delishkitchen.tv/recipes/194135459369058708' })).status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
    vi.stubEnv('VERCEL_ENV', 'production')
    expect((await call({ url: 'https://delishkitchen.tv/recipes/194135459369058708' })).status).toBe(200)
  })
})

describe('/api/recipe-import の回数の上限', () => {
  const uid = '11111111-2222-4333-8444-555555555555'
  function stubWithCount(total) {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url, init) => {
        const u = String(url)
        if (u.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: uid }), { status: 200 })
        if (u.includes('/rest/v1/recipe_import_runs?')) return new Response('[]', { status: 206, headers: { 'content-range': `0-0/${total}` } })
        if (u.endsWith('/rest/v1/recipe_import_runs')) return new Response(null, { status: 201 })
        if (u === 'https://delishkitchen.tv/recipes/194135459369058708') return new Response(page, { headers: { 'content-type': 'text/html' } })
        return new Response('not found', { status: 404, statusText: String(init?.method) })
      })
    )
  }

  it('この1時間に30回取り込んだ人は、外部サイトにアクセスせずに断る', async () => {
    stubWithCount(30)
    const { status, json } = await call({ url: 'https://delishkitchen.tv/recipes/194135459369058708' })
    expect(status).toBe(429)
    expect(json).toEqual({ error: 'rate_limited' })
    expect(fetch.mock.calls.some(([u]) => String(u).startsWith('https://delishkitchen.tv'))).toBe(false)
    // 本人の記録だけを、サーバー専用の鍵で数える
    const count = fetch.mock.calls.find(([u]) => String(u).includes('/rest/v1/recipe_import_runs?'))
    expect(String(count[0])).toContain(`user_id=eq.${uid}`)
    expect(count[1].headers.Authorization).toBe('Bearer service')
  })

  it('上限より少なければ取り込める', async () => {
    stubWithCount(29)
    const { status } = await call({ url: 'https://delishkitchen.tv/recipes/194135459369058708' })
    expect(status).toBe(200)
  })

  it('数えられないとき(鍵が未設定)は、取り込みを止めない', async () => {
    stubWithCount(999)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '')
    const { status } = await call({ url: 'https://delishkitchen.tv/recipes/194135459369058708' })
    expect(status).toBe(200)
  })
})

describe('/api/recipe-import の汎用の読み取り(対応サイト以外)', () => {
  const rowsOf = (table) => fetch.mock.calls.filter(([u]) => String(u).endsWith(`/rest/v1/${table}`)).map(([, init]) => JSON.parse(init.body))
  const html = (body) => ({ body, type: 'text/html', status: 200, url: 'https://blog.example.com/hamburg' })

  it('構造化データ(microdata)があれば読み取り、URL から重複を見分けるキーを作る', async () => {
    const micro = `<div itemscope itemtype="https://schema.org/Recipe"><h1 itemprop="name">ハンバーグ</h1><span itemprop="recipeYield">2人分</span>
      <li itemprop="recipeIngredient">合い挽き肉 300g</li><li itemprop="recipeIngredient">玉ねぎ 1個</li><div itemprop="recipeInstructions">秘密の手順</div></div>`
    safeFetch.mockImplementation(async (url) => (url.endsWith('/robots.txt') ? { body: 'User-agent: *\nDisallow: /private/', type: 'text/plain', status: 200 } : html(micro)))
    const { status, json } = await call({ url: 'https://blog.example.com/hamburg?utm_source=x' })
    expect(status).toBe(200)
    expect(json).toMatchObject({ title: 'ハンバーグ', servings: 2, ingredients: ['合い挽き肉 300g', '玉ねぎ 1個'], site: 'blog.example.com', method: 'microdata', url: 'https://blog.example.com/hamburg' })
    expect(json.sourceKey).toMatch(/^web:[0-9a-f]{32}$/)
    expect(JSON.stringify(json)).not.toContain('秘密の手順')
    expect(rowsOf('recipe_import_runs')).toEqual([{ site: 'generic', outcome: 'success', method: 'microdata' }])
  })

  it('robots.txt で禁止されたページは取得しない(記録する)', async () => {
    safeFetch.mockImplementation(async (url) => (url.endsWith('/robots.txt') ? { body: 'User-agent: *\nDisallow: /', type: 'text/plain', status: 200 } : html('x')))
    const { status, json } = await call({ url: 'https://blog.example.com/hamburg' })
    expect(status).toBe(422)
    expect(json.error).toBe('robots_disallowed')
    expect(safeFetch).toHaveBeenCalledTimes(1)
    expect(rowsOf('recipe_import_failures')).toEqual([{ site: 'generic', host: 'blog.example.com', path: '/hamburg', reason: 'robots_disallowed', http_status: null, features: {} }])
  })

  it('読み取れなかったページは、理由とページの特徴(本文は含めない)を記録する。クエリ文字列は記録しない', async () => {
    const article = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Article', headline: '日記' })}</script><p>今日の晩ごはん</p>`
    safeFetch.mockImplementation(async (url) => (url.endsWith('/robots.txt') ? { error: 'fetch_status', status: 404 } : html(article)))
    const { status, json } = await call({ url: 'https://blog.example.com/diary?id=secret' })
    expect(status).toBe(422)
    expect(json.error).toBe('no_recipe_data')
    const [row] = rowsOf('recipe_import_failures')
    expect(row).toMatchObject({ site: 'generic', host: 'blog.example.com', path: '/diary', reason: 'no_recipe_data', http_status: 200 })
    expect(row.features).toMatchObject({ ld_blocks: 1, ld_types: ['Article'], microdata_recipe: false })
    expect(JSON.stringify(row)).not.toContain('晩ごはん')
    expect(JSON.stringify(row)).not.toContain('secret')
  })

  it('社内のアドレスに向かう名前は、取得しないで記録する', async () => {
    safeFetch.mockResolvedValue({ error: 'blocked_host' })
    const { status, json } = await call({ url: 'https://internal-looking.example.com/x' })
    expect(status).toBe(422)
    expect(json.error).toBe('unsupported_url')
    expect(rowsOf('recipe_import_runs')).toEqual([{ site: 'generic', outcome: 'blocked' }])
  })

  it('IP アドレス・社内向けの名前・https/http 以外は、取得する前に断る', async () => {
    for (const url of ['https://10.0.0.1/r', 'https://[::1]/r', 'https://printer.local/r', 'https://localhost/r', 'ftp://a.example.com/r', 'https://a.example.com:8443/r', 'https://user:pw@a.example.com/r']) {
      expect((await call({ url })).json.error).toBe('unsupported_url')
    }
    expect(safeFetch).not.toHaveBeenCalled()
  })
})
