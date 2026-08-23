import { useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'

const DELETE_WIDTH = 76
const OPEN_THRESHOLD = DELETE_WIDTH / 2

// 左にスワイプすると削除ボタンが現れるリスト行のラッパー。
// タップ自体は子要素(数量ボタン等)にそのまま通す。
export function SwipeToDelete({ onDelete, children, className = '' }) {
  const [translateX, setTranslateX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startXRef = useRef(0)
  const startTranslateRef = useRef(0)
  const wasOpenRef = useRef(false)

  function handlePointerDown(e) {
    startXRef.current = e.clientX
    startTranslateRef.current = translateX
    wasOpenRef.current = translateX !== 0
    setDragging(true)
  }

  function handlePointerMove(e) {
    if (!dragging) return
    const delta = e.clientX - startXRef.current
    const next = Math.min(0, Math.max(-DELETE_WIDTH, startTranslateRef.current + delta))
    setTranslateX(next)
  }

  function handlePointerUp() {
    if (!dragging) return
    setDragging(false)
    setTranslateX((prev) => (prev < -OPEN_THRESHOLD ? -DELETE_WIDTH : 0))
  }

  function handleClickCapture(e) {
    // 開いた状態でのタップは閉じるだけにし、内側のボタンの誤操作を防ぐ
    if (wasOpenRef.current) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex items-center justify-center bg-destructive text-white"
        style={{ width: DELETE_WIDTH }}
        onClick={onDelete}
        aria-label="削除"
      >
        <Trash2 className="size-4" />
      </button>
      <div
        className="relative bg-background touch-pan-y"
        style={{
          transform: `translateX(${translateX}px)`,
          transition: dragging ? 'none' : 'transform 0.2s ease',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClickCapture={handleClickCapture}
      >
        {children}
      </div>
    </div>
  )
}
