import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetForTests, applyUpdate, getState, hardReload, setBusy, setUpdateFn, subscribe } from './swUpdate'

describe('swUpdate', () => {
  afterEach(() => __resetForTests())

  it('入力中のキーがすべて外れるまで busy を保つ', () => {
    const listener = vi.fn()
    subscribe(listener)
    setBusy('a', true)
    setBusy('b', true)
    setBusy('a', false)
    expect(getState().busy).toBe(true)
    setBusy('b', false)
    expect(getState().busy).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('applyUpdate はリロードを伴う更新関数を呼ぶ', async () => {
    const update = vi.fn()
    setUpdateFn(update)
    await applyUpdate({ serviceWorker: null, reload: vi.fn(), setTimer: () => {} })
    expect(update).toHaveBeenCalledWith(true)
  })

  it('制御が新しい SW に移ったら、workbox に頼らず自分でもリロードする(1回だけ)', async () => {
    const target = new EventTarget()
    const waiting = { postMessage: vi.fn() }
    target.getRegistration = async () => ({ waiting })
    const reload = vi.fn()
    setUpdateFn(vi.fn())
    await applyUpdate({ serviceWorker: target, reload, setTimer: () => {}, now: () => 1000 })
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).not.toHaveBeenCalled()
    target.dispatchEvent(new Event('controllerchange'))
    target.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('待機中の SW が有効にならず制御も移らない端末でも、一定時間後に必ず読み直す', async () => {
    const target = new EventTarget()
    target.getRegistration = async () => ({ waiting: { postMessage: vi.fn() } })
    const reload = vi.fn()
    let timer = null
    await applyUpdate({ serviceWorker: target, reload, setTimer: (fn, ms) => (timer = { fn, ms }), now: () => 1000 })
    expect(timer.ms).toBe(4000)
    timer.fn()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('待機中の SW がない(すでに新しい SW に切り替わっている)ときは、すぐに読み直す', async () => {
    const target = new EventTarget()
    target.getRegistration = async () => ({ waiting: null })
    const reload = vi.fn()
    await applyUpdate({ serviceWorker: target, reload, setTimer: (fn, ms) => ms === 0 && fn(), now: () => 1000 })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('前回の「更新する」から2分以内にもう一度押されたら、SW の登録とキャッシュを消して読み直す(更新の画面から抜け出せる)', async () => {
    const unregister = vi.fn().mockResolvedValue(true)
    const target = new EventTarget()
    target.getRegistration = async () => ({ waiting: null })
    target.getRegistrations = async () => [{ unregister }, { unregister }]
    const cacheStorage = { keys: async () => ['workbox-precache-v2', 'other'], delete: vi.fn().mockResolvedValue(true) }
    const reload = vi.fn()
    localStorage.setItem('cookdoor.activeGroupId', 'keep-me')
    await applyUpdate({ serviceWorker: target, cacheStorage, reload, setTimer: () => {}, now: () => 10_000 })
    expect(unregister).not.toHaveBeenCalled()
    await applyUpdate({ serviceWorker: target, cacheStorage, reload, setTimer: () => {}, now: () => 10_000 + 60_000 })
    expect(unregister).toHaveBeenCalledTimes(2)
    expect(cacheStorage.delete).toHaveBeenCalledTimes(2)
    expect(reload).toHaveBeenCalledTimes(1)
    // ログイン状態・選んでいる家は消さない
    expect(localStorage.getItem('cookdoor.activeGroupId')).toBe('keep-me')
    localStorage.removeItem('cookdoor.activeGroupId')
  })

  it('2分より前の「更新する」は数えない(通常の更新)', async () => {
    const unregister = vi.fn()
    const target = new EventTarget()
    target.getRegistration = async () => ({ waiting: null })
    target.getRegistrations = async () => [{ unregister }]
    await applyUpdate({ serviceWorker: target, reload: vi.fn(), setTimer: () => {}, now: () => 0 + 1 })
    __resetForTests()
    localStorage.setItem('cookdoor:updateAttemptAt', '1')
    await applyUpdate({ serviceWorker: target, reload: vi.fn(), setTimer: () => {}, now: () => 1 + 3 * 60_000 })
    expect(unregister).not.toHaveBeenCalled()
  })

  it('hardReload は消せなくても必ず読み直す', async () => {
    const reload = vi.fn()
    await hardReload({ serviceWorker: { getRegistrations: () => Promise.reject(new Error('x')) }, cacheStorage: null, reload })
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
