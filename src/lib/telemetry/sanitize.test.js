import { describe, expect, it } from 'vitest'
import { fingerprintOf, maskSecrets, sanitizeMessage, sanitizeStack, MAX_MESSAGE_LENGTH } from './sanitize'

describe('エラー文面の伏せ字', () => {
  it('レシピの参照先 URL や外部の URL は丸ごと伏せる', () => {
    const out = maskSecrets('Failed to fetch https://cookpad.com/recipe/12345?utm=x and http://example.com/a')
    expect(out).toBe('Failed to fetch [url] and [url]')
  })

  it('アプリのファイルはパスと行・列だけを残す', () => {
    expect(maskSecrets('at f (https://cookdoor.app/assets/index-XueKmQo4.js:12:345)')).toBe(
      'at f (/assets/index-XueKmQo4.js:12:345)'
    )
    // アプリのページ URL(招待リンクなど)は伏せる
    expect(maskSecrets('https://cookdoor.app/onboarding?code=ABCD1234')).toBe('[url]')
  })

  it('Supabase の URL、JWT、Bearer、key=value のトークンを伏せる', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.abcDEF123_-'
    const out = maskSecrets(
      `POST https://abcd.supabase.co/rest/v1/x failed ${jwt} Bearer ${jwt} refresh_token=r3fr3sh&x=1 apikey=xyz`
    )
    expect(out).not.toMatch(/supabase\.co|eyJ|r3fr3sh|xyz/)
    expect(out).toContain('[url]')
    expect(out).toContain('Bearer [redacted]')
    expect(out).toContain('refresh_token=[redacted]')
  })

  it('メールアドレス、UUID、招待コード、長いランダム文字列を伏せる', () => {
    const out = maskSecrets(
      'user taro.yamada+cook@example.co.jp id 123e4567-e89b-12d3-a456-426614174000 code 0A1B2C3D tok AbCdEfGhIjKlMnOpQrStUvWxYz012345678'
    )
    expect(out).toBe('user [email] id [id] code [code] tok [token]')
  })

  it('食材名やレシピ名などの日本語・文章が入った引用は伏せ、短いプロパティ名は残す', () => {
    expect(maskSecrets(`Cannot read properties of undefined (reading 'name')`)).toBe(
      `Cannot read properties of undefined (reading 'name')`
    )
    expect(maskSecrets(`invalid value "鶏もも肉 200g"`)).toBe('invalid value "[text]"')
    expect(maskSecrets(`title 「肉じゃが」 not found`)).toBe('title 「[text]」 not found')
    expect(maskSecrets(`got 'my grandma secret curry'`)).toBe(`got '[text]'`)
  })

  it('長さを制限し、空のメッセージにも値を入れる', () => {
    expect(sanitizeMessage('x '.repeat(1000))).toHaveLength(MAX_MESSAGE_LENGTH)
    expect(sanitizeMessage('')).toBe('(no message)')
    expect(sanitizeMessage(undefined)).toBe('(no message)')
    expect(sanitizeStack(null)).toBeNull()
    const longStack = Array.from({ length: 50 }, (_, i) => `at f${i} (https://cookdoor.app/assets/a.js:${i}:1)`).join('\n')
    expect(sanitizeStack(longStack).split('\n')).toHaveLength(12)
  })

  it('同じ内容からは同じ8桁の16進数を作る', () => {
    expect(fingerprintOf('error', 'a')).toMatch(/^[0-9a-f]{8}$/)
    expect(fingerprintOf('error', 'a')).toBe(fingerprintOf('error', 'a'))
    expect(fingerprintOf('error', 'a')).not.toBe(fingerprintOf('error', 'b'))
  })
})
