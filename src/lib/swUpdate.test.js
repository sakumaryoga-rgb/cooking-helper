import { afterEach, describe, expect, it, vi } from 'vitest'
import { __resetForTests, applyUpdate, getState, setBusy, setUpdateFn, subscribe } from './swUpdate'

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

  it('applyUpdate はリロードを伴う更新関数を呼ぶ', () => {
    const update = vi.fn()
    setUpdateFn(update)
    applyUpdate({ serviceWorker: null })
    expect(update).toHaveBeenCalledWith(true)
  })

  it('制御が新しい SW に移ったら、workbox に頼らず自分でもリロードする', () => {
    const target = new EventTarget()
    const reload = vi.fn()
    setUpdateFn(vi.fn())
    applyUpdate({ serviceWorker: target, reload })
    applyUpdate({ serviceWorker: target, reload }) // 連打しても待ち受けは1つだけ
    expect(reload).not.toHaveBeenCalled()
    target.dispatchEvent(new Event('controllerchange'))
    target.dispatchEvent(new Event('controllerchange'))
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
