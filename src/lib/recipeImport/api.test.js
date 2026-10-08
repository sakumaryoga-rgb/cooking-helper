import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../../api/recipe-import.js'

function call(body, headers = { authorization: 'Bearer good.token.x' }) {
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b } }
  return handler({ method: 'POST', headers, body }, res).then(() => ({ status: res.statusCode, json: JSON.parse(res.body) }))
}

const page = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Recipe', name: 'バンバンジー', recipeYield: '2人分', recipeIngredient: ['鶏むね肉 1枚(250g)'], recipeInstructions: ['秘密の手順'] })}</script>`

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const u = String(url)
      if (u.endsWith('/auth/v1/user')) return new Response('{}', { status: 200 })
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
  })

  it('ログインしていなければ取得しない', async () => {
    fetch.mockImplementationOnce(async () => new Response('{}', { status: 401 }))
    expect((await call({ url: 'https://delishkitchen.tv/recipes/194135459369058708' })).status).toBe(401)
    expect((await call({ url: 'https://delishkitchen.tv/recipes/194135459369058708' }, {})).status).toBe(401)
  })

  it('対応サイト以外の URL と、他のホストへのリダイレクトはたどらない', async () => {
    expect((await call({ url: 'http://169.254.169.254/latest/meta-data' })).json.error).toBe('unsupported_url')
    expect((await call({ url: 'https://cookpad.com/recipe/1' })).status).toBe(422)
    const redirected = await call({ url: 'https://oceans-nadia.com/user/1/recipe/2' })
    expect(redirected).toMatchObject({ status: 502, json: { reason: 'redirect' } })
    expect(fetch).not.toHaveBeenCalledWith('https://evil.example/', expect.anything())
  })

  it('接続情報がない環境(Preview)では使えない', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    expect((await call({ url: 'https://delishkitchen.tv/recipes/194135459369058708' })).status).toBe(503)
  })
})
