import { useEffect, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'

const DELETE_WIDTH = 76
const OPEN_THRESHOLD = DELETE_WIDTH / 2
// ドラッグ量が行幅のこの割合を超えて指を離すと、途中で止めずにそのまま
// 削除まで滑らせる(iOS Mail等の「流れるように消える」スワイプ削除と同じ挙動)
const COMMIT_RATIO = 0.45

const EXITING_PHASES = new Set(['exiting', 'measured', 'collapsing'])

// 左にスワイプすると削除ボタンが現れ、大きくスワイプするとそのまま
// 流れるように消えるリスト行のラッパー。タップ自体は子要素(数量ボタン等)に
// そのまま通す。onDelete は退場アニメーションが完了してから一度だけ呼ばれる。
//
// CSSのtransitionは「transitionプロパティ自体の変更」と「アニメーション対象の
// 値の変更」を同じコミットで同時に行うと発火しない(ブラウザがそのフレームを
// アニメーションの起点として認識できないため)。そのため各段階で
// 1. transitionを有効にするレンダー
// 2. その次のフレームで実際の目標値を変えるレンダー
// を必ず分けている(phase='exiting'→次フレームでtranslateX/opacityを変更、
// phase='measured'→次フレームでphase='collapsing'にしてmax-heightを変更)。
export function SwipeToDelete({ onDelete, children, className = '' }) {
  const [translateX, setTranslateX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [phase, setPhase] = useState('idle') // 'idle' | 'exiting' | 'measured' | 'collapsing'
  const [exited, setExited] = useState(false)
  const [measuredHeight, setMeasuredHeight] = useState(null)
  const startXRef = useRef(0)
  const startTranslateRef = useRef(0)
  const wasOpenRef = useRef(false)
  const widthRef = useRef(320)
  const rootRef = useRef(null)

  function handlePointerDown(e) {
    if (phase !== 'idle') return
    // キャプチャしないと、行の外まで大きくスワイプした際に以降のpointermove/upが
    // 別要素に取られて追跡が止まってしまう(特にマウス操作時)
    e.currentTarget.setPointerCapture(e.pointerId)
    widthRef.current = rootRef.current?.offsetWidth || 320
    startXRef.current = e.clientX
    startTranslateRef.current = translateX
    wasOpenRef.current = translateX !== 0
    setDragging(true)
  }

  function handlePointerMove(e) {
    if (!dragging) return
    const delta = e.clientX - startXRef.current
    const next = Math.min(0, Math.max(-widthRef.current, startTranslateRef.current + delta))
    setTranslateX(next)
  }

  function commitDelete() {
    // 退場アニメーション中に(ダブルタップ等で)再度呼ばれても多重発火させない
    if (phase !== 'idle') return
    setDragging(false)
    setPhase('exiting')
  }

  function handlePointerUp(e) {
    if (!dragging) return
    setDragging(false)
    const delta = e.clientX - startXRef.current
    if (wasOpenRef.current && Math.abs(delta) < 4) {
      // 開いた状態でのタップは閉じるだけにする
      requestAnimationFrame(() => setTranslateX(0))
      return
    }
    if (translateX < -widthRef.current * COMMIT_RATIO) {
      commitDelete()
      return
    }
    const target = translateX < -OPEN_THRESHOLD ? -DELETE_WIDTH : 0
    requestAnimationFrame(() => setTranslateX(target))
  }

  function handleClickCapture(e) {
    // 開いた状態でのタップは閉じるだけにし、内側のボタンの誤操作を防ぐ
    if (wasOpenRef.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // phase='exiting'(transition有効化)の次のフレームで実際に画面外へ動かす
  useEffect(() => {
    if (phase !== 'exiting') return
    const id = requestAnimationFrame(() => {
      setTranslateX(-(widthRef.current + DELETE_WIDTH))
      setExited(true)
    })
    return () => cancelAnimationFrame(id)
  }, [phase])

  function handleSlideEnd(e) {
    if (e.target !== e.currentTarget || e.propertyName !== 'transform') return
    if (phase !== 'exiting') return
    // 高さを実測値→0へ変化させることで、崩れ落ちるような縮小アニメーションにする
    setMeasuredHeight(rootRef.current?.offsetHeight ?? 0)
    setPhase('measured')
  }

  // phase='measured'(高さ固定+transition有効化)の次のフレームで0にする
  useEffect(() => {
    if (phase !== 'measured') return
    const id = requestAnimationFrame(() => setPhase('collapsing'))
    return () => cancelAnimationFrame(id)
  }, [phase])

  function handleRootTransitionEnd(e) {
    if (e.propertyName !== 'max-height' || phase !== 'collapsing') return
    onDelete()
  }

  return (
    <div
      ref={rootRef}
      className={`relative overflow-hidden ${className}`}
      style={{
        maxHeight: phase === 'collapsing' ? 0 : (measuredHeight ?? undefined),
        transition: phase === 'measured' || phase === 'collapsing' ? 'max-height 180ms ease-in' : undefined,
      }}
      onTransitionEnd={handleRootTransitionEnd}
    >
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-destructive text-white"
        style={{ width: DELETE_WIDTH }}
        onClick={commitDelete}
        aria-label="削除"
      >
        <Trash2 className="size-4" />
      </button>
      <div
        className="relative bg-background touch-pan-y"
        style={{
          transform: `translateX(${translateX}px)`,
          opacity: exited ? 0 : 1,
          transition: dragging
            ? 'none'
            : EXITING_PHASES.has(phase)
              ? 'transform 220ms ease-in, opacity 220ms ease-in'
              : 'transform 200ms ease-out',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={handleClickCapture}
        onTransitionEnd={handleSlideEnd}
      >
        {children}
      </div>
    </div>
  )
}
