import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkMinSupportedVersion, compareVersions, APP_VERSION } from './appVersion'
import { __resetForTests, getState } from './swUpdate'
import pkg from '../../package.json'

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['1.0.10', '1.0.9', 1],
    ['1.0.0', '1.1', -1],
    ['2.0', '1.9.9', 1],
  ])('%s と %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign)
  })
})

describe('checkMinSupportedVersion', () => {
  afterEach(() => {
    __resetForTests()
    vi.unstubAllGlobals()
  })

  const stubFetch = (body, ok = true) =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(body) }))

  it('アプリのバージョンは package.json と一致する', () => {
    expect(APP_VERSION).toBe(pkg.version)
  })

  it('最低バージョンより古ければ強制更新にする', async () => {
    stubFetch({ minSupportedVersion: '1.0.1' })
    await expect(checkMinSupportedVersion('1.0.0')).resolves.toBe(true)
    expect(getState().forceUpdateRequired).toBe(true)
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/^\/version\.json\?t=\d+$/), { cache: 'no-store' })
  })

  it('最低バージョン以上なら何もしない', async () => {
    stubFetch({ minSupportedVersion: '0.0.0' })
    await expect(checkMinSupportedVersion('1.0.0')).resolves.toBe(false)
    expect(getState().forceUpdateRequired).toBe(false)
  })

  it('取得に失敗しても例外を出さず何もしない', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(checkMinSupportedVersion('1.0.0')).resolves.toBe(false)
    stubFetch({}, false)
    await expect(checkMinSupportedVersion('1.0.0')).resolves.toBe(false)
    expect(getState().forceUpdateRequired).toBe(false)
  })
})
