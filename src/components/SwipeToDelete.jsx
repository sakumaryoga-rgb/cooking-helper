import { useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'

const DELETE_WIDTH = 76
const OPEN_THRESHOLD = DELETE_WIDTH / 2
// ドラッグ量が行幅のこの割合を超えて指を離すと、途中で止めずにそのまま
// 削除まで滑らせる(iOS Mail等の「流れるように消える」スワイプ削除と同じ挙動)
const COMMIT_RATIO = 0.45

// 左にスワイプすると削除ボタンが現れ、大きくスワイプするとそのまま
// 流れるように消えるリスト行のラッパー。タップ自体は子要素(数量ボタン等)に
// そのまま通す。onDelete は退場アニメーションが完了してから一度だけ呼ばれる。
export function SwipeToDelete({ onDelete, children, className = '' }) {
  const [translateX, setTranslateX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [phase, setPhase] = useState('idle') // 'idle' | 'exiting' | 'collapsing'
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
    setDragging(false)
    setPhase('exiting')
    setTranslateX(-(widthRef.current + DELETE_WIDTH))
  }

  function handlePointerUp(e) {
    if (!dragging) return
    setDragging(false)
    const delta = e.clientX - startXRef.current
    if (wasOpenRef.current && Math.abs(delta) < 4) {
      // 開いた状態でのタップは閉じるだけにする
      setTranslateX(0)
      return
    }
    if (translateX < -widthRef.current * COMMIT_RATIO) {
      commitDelete()
      return
    }
    setTranslateX((prev) => (prev < -OPEN_THRESHOLD ? -DELETE_WIDTH : 0))
  }

  function handleClickCapture(e) {
    // 開いた状態でのタップは閉じるだけにし、内側のボタンの誤操作を防ぐ
    if (wasOpenRef.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  function handleSlideEnd(e) {
    if (e.target !== e.currentTarget || e.propertyName !== 'transform') return
    if (phase !== 'exiting') return
    // 高さを実測値→0へ変化させることで、崩れ落ちるような縮小アニメーションにする
    setMeasuredHeight(rootRef.current?.offsetHeight ?? 0)
    requestAnimationFrame(() => setPhase('collapsing'))
  }

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
        transition: phase === 'collapsing' ? 'max-height 180ms ease-in' : undefined,
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
          opacity: phase === 'exiting' ? 0 : 1,
          transition:
            dragging
              ? 'none'
              : phase === 'exiting'
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
