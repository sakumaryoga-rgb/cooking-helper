import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetActiveGroupForTests, getActiveGroupId, pickActiveGroup, setActiveGroupId, withGroupHeader } from './activeGroup'
import { maskEmail } from './maskEmail'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('選んでいる家', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetActiveGroupForTests()
  })

  it('DB 呼び出しに選んでいる家のヘッダーを付ける(選んでいなければ付けない)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}'))
    const f = withGroupHeader(fetchImpl)
    await f('https://x/rest/v1/ingredients', { headers: { apikey: 'k' } })
    expect(fetchImpl.mock.calls[0][1].headers.get?.('x-cookdoor-group') ?? null).toBeNull()
    setActiveGroupId(A)
    await f('https://x/rest/v1/ingredients', { headers: { apikey: 'k' } })
    const h = fetchImpl.mock.calls[1][1].headers
    expect(h.get('x-cookdoor-group')).toBe(A)
    expect(h.get('apikey')).toBe('k')
  })

  it('前回選んだ家を次回の起動で復元し、所属していなければ最初の家にする', () => {
    setActiveGroupId(B)
    __resetActiveGroupForTests()
    expect(getActiveGroupId()).toBeNull()
    expect(pickActiveGroup([{ id: A }, { id: B }])).toEqual({ id: B })
    expect(pickActiveGroup([{ id: A }])).toEqual({ id: A })
    expect(pickActiveGroup([])).toBeNull()
  })

  it('UUID でない値は使わない', () => {
    setActiveGroupId('not-a-uuid')
    expect(getActiveGroupId()).toBeNull()
  })
})

describe('メールアドレスの伏せ字', () => {
  it.each([
    ['taro.yamada@gmail.com', 'ta***@gm***.com'],
    ['a@example.co.jp', 'a***@ex***.co.jp'],
    ['', ''],
  ])('%s → %s', (input, expected) => expect(maskEmail(input)).toBe(expected))
})
