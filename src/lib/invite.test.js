import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildInviteUrl, capturePendingInvite, parseInviteToken, takePendingInvite } from './invite'

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_x'

describe('招待リンク', () => {
  beforeEach(() => localStorage.clear())

  it('トークンは URL のハッシュに置く', () => {
    expect(buildInviteUrl('https://cookdoor.app', TOKEN)).toBe(`https://cookdoor.app/onboarding#invite=${TOKEN}`)
  })

  it.each([
    [TOKEN, TOKEN],
    [`https://cookdoor.app/onboarding#invite=${TOKEN}`, TOKEN],
    [`  #invite=${TOKEN}  `, TOKEN],
    ['ABCD1234', null],
    [`#invite=${TOKEN}extra`, null],
    ['', null],
    [null, null],
  ])('%s から %s を取り出す', (input, expected) => {
    expect(parseInviteToken(input)).toBe(expected)
  })

  it('開いたリンクのトークンを覚えて URL から消し、1回だけ取り出せる', () => {
    const replace = vi.fn()
    capturePendingInvite({ pathname: '/onboarding', search: '', hash: `#invite=${TOKEN}` }, replace)
    expect(replace).toHaveBeenCalledWith('/onboarding')
    expect(takePendingInvite()).toEqual({ token: TOKEN, legacy: false })
    expect(takePendingInvite()).toEqual({ token: null, legacy: false })
  })

  it('旧方式のリンク(?code=)は使えないことを案内するために覚える', () => {
    capturePendingInvite({ pathname: '/onboarding', search: '?code=ABCD1234', hash: '' }, vi.fn())
    expect(takePendingInvite()).toEqual({ token: null, legacy: true })
  })
})
