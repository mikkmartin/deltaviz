import { useRef, useState } from 'react'
import { ACCENT, gray } from './palette.js'

/**
 * A labelled switch after Fluid Functionalism's (fluidfunctionalism.com/docs/switch), compact size:
 * the whole row toggles on a click; the thumb (toned down from the source) widens a little on
 * press, and drags across the track (released past the middle, it toggles). `checked` stays
 * the parent's: the switch only asks (`onToggle`). Space or Enter on it toggles too.
 */

const TRACK_W = 28
const TRACK_H = 16
const THUMB = 12
/** Between a resting thumb and the track's edges */
const OFFSET = 2
/** Calmer than the source (2/3/3): no stretch on hover, a slight one on press, no squash */
const HOVER_EXTEND = 0
const PRESS_EXTEND = 2
const PRESS_SHRINK = 0
/** Pointer travel before a press is a drag */
const DEAD_ZONE = 2
const TRAVEL = TRACK_W - THUMB - OFFSET * 2
/** A plain ease, no snap: the source's `moderate` tier read as bouncy here */
const MOVE = '180ms cubic-bezier(.4, 0, .2, 1)'

export const SWITCH_CSS = `
.switch { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; touch-action: none; font-size: 11px; color: ${gray[400]}; }
.switch:hover { color: ${gray[200]}; }
/* Side by side (the bar's 6px gap, and this), they read as separate controls */
.switch + .switch { margin-left: 8px; }
.switch.off { opacity: 0.4; pointer-events: none; }
.switch-track { position: relative; flex: none; width: ${TRACK_W}px; height: ${TRACK_H}px; border-radius: 999px; outline: none; transition: background-color 80ms; background: ${gray[700]}; }
.switch:hover .switch-track { background: color-mix(in oklab, ${gray[700]}, white 10%); }
.switch-track[aria-checked="true"] { background: ${ACCENT}; }
.switch:hover .switch-track[aria-checked="true"] { background: color-mix(in oklab, ${ACCENT}, black 8%); }
.switch-track:focus-visible { box-shadow: 0 0 0 2px ${gray[950]}, 0 0 0 3px ${ACCENT}; }
.switch-thumb { position: absolute; top: 0; left: 0; border-radius: 999px; background: white; box-shadow: 0 1px 2px rgb(0 0 0 / 0.3); }
@media (prefers-reduced-motion: reduce) { .switch-thumb { transition: none !important; } }
`

export function Switch({ label, checked, onToggle, disabled, title }: { label: string; checked: boolean; onToggle(): void; disabled?: boolean; title?: string }) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed] = useState(false)
  /** While dragging: the thumb's x, following the pointer */
  const [dragX, setDragX] = useState<number | null>(null)
  const press = useRef<{ x: number; from: number; dragged: boolean } | null>(null)
  /** The click that ends a drag mustn't toggle again */
  const swallow = useRef(false)

  const w = THUMB + (pressed ? PRESS_EXTEND : hovered ? HOVER_EXTEND : 0)
  const h = THUMB - (pressed ? PRESS_SHRINK : 0)
  // On, the extra width grows leftward: the thumb's outer edge stays put.
  const rest = checked ? OFFSET + TRAVEL - (w - THUMB) : OFFSET
  const x = dragX ?? rest
  const dragMax = TRACK_W - OFFSET - (THUMB + PRESS_EXTEND)

  return (
    <div
      className={`switch${disabled ? ' off' : ''}`}
      title={title}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onPointerDown={(e) => {
        if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return
        setPressed(true)
        press.current = { x: e.clientX, from: rest, dragged: false }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const p = press.current
        if (!p) return
        const d = e.clientX - p.x
        if (!p.dragged && Math.abs(d) < DEAD_ZONE) return
        p.dragged = true
        setDragX(Math.max(OFFSET, Math.min(dragMax, p.from + d)))
      }}
      onPointerUp={() => {
        const p = press.current
        press.current = null
        setPressed(false)
        if (!p?.dragged) return
        swallow.current = true
        requestAnimationFrame(() => (swallow.current = false))
        const on = (dragX ?? rest) > (OFFSET + dragMax) / 2
        setDragX(null)
        if (on !== checked) onToggle()
      }}
      onPointerCancel={() => ((press.current = null), setPressed(false), setDragX(null))}
      onClick={() => !disabled && !swallow.current && onToggle()}
    >
      <span
        className="switch-track"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(e) => {
          if (e.key !== ' ' && e.key !== 'Enter') return
          e.preventDefault()
          onToggle()
        }}
      >
        <span
          className="switch-thumb"
          style={{
            width: w,
            height: h,
            transform: `translate(${x}px, ${OFFSET + (THUMB - h) / 2}px)`,
            // Mid-drag the pointer has it; otherwise everything glides.
            transition: dragX === null ? `transform ${MOVE}, width ${MOVE}, height ${MOVE}` : `width ${MOVE}, height ${MOVE}`,
          }}
        />
      </span>
      {label}
    </div>
  )
}
