import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ACCENT, gray } from './palette.js'

/**
 * The page's left sidebar, after Fluid Functionalism's Sidebar (offcanvas, with a rail):
 * ⌘B / Ctrl-B slides it fully away and back; its inner edge is a rail that drags to resize
 * (MIN–MAX), collapses on a click or a drag well past MIN. Open and width are kept across visits.
 */

export const SIDEBAR_W = 320
const MIN = 160
const MAX = 480
/** A drag this far under MIN collapses it on release */
const COLLAPSE_SLOP = 56
/** Between the sidebar and what's beside it, collapsed with it */
const GAP = 14
/** A press that moves less than this is a click */
const CLICK_PX = 3
/** Opening settles like a critically damped spring; closing is quicker and plain (the source's `slow` tier and its exit) */
const OPEN = '240ms cubic-bezier(.22, 1, .36, 1)'
const CLOSE = '160ms ease-out'
/** How far its content slides as it goes */
const SLIDE = 40

export const SIDEBAR_CSS = `
.sb { flex: none; position: relative; overflow: hidden; }
.sb-inner { height: 100%; display: flex; }
.sb-inner > * { flex: 1; min-width: 0; }
.sb-rail { position: absolute; top: 0; bottom: 0; width: 9px; cursor: ew-resize; touch-action: none; }
.sb-rail::after { content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px; background: ${ACCENT}; opacity: 0; transition: opacity 80ms; }
.sb-rail:hover::after, .sb-rail.on::after { opacity: 1; }
.sb-toggle { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; color: ${gray[400]}; flex: none; }
.sb-toggle:hover { background: ${gray[800]}; color: ${gray[200]}; }
@media (prefers-reduced-motion: reduce) { .sb, .sb-inner { transition: none !important; } }
`

function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const full = `deltaviz:${key}`
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(full)
      return saved === null ? initial : (JSON.parse(saved) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(full, JSON.stringify(value))
    } catch {}
  }, [full, value])
  return [value, setValue]
}

/** Whether the sidebar is open, and a toggle; ⌘B / Ctrl-B toggles it too (not while typing) */
export function useSidebar(): { open: boolean; setOpen: (v: boolean) => void; toggle: () => void } {
  const [open, setOpen] = useStored('sidebar-open', true)
  const toggle = useCallback(() => setOpen(!open), [open, setOpen])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'b') return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      e.preventDefault()
      toggle()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [toggle])
  return { open, setOpen, toggle }
}

export function Sidebar({ open, setOpen, children }: { open: boolean; setOpen: (v: boolean) => void; children: ReactNode }) {
  const [stored, store] = useStored('sidebar-width', SIDEBAR_W)
  /** While dragging, the width as it goes (stored once released) */
  const [live, setLive] = useState<number | null>(null)
  const width = live ?? stored
  /** While dragging the rail: where it started, and whether it's moved enough to be a drag */
  const drag = useRef<{ x: number; w: number; moved: boolean; collapse: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const w = Math.min(MAX, Math.max(MIN, width))
  return (
    <div className="sb" style={{ width: open ? w + GAP : 0, transition: dragging ? 'none' : `width ${open ? OPEN : CLOSE}` }} aria-hidden={!open || undefined}>
      {/* Its own width, whatever the frame's; leaving, it slides out and fades with the frame (back in, opening). */}
      <div
        className="sb-inner"
        style={{
          width: w,
          opacity: open ? 1 : 0,
          transform: open ? 'none' : `translateX(-${SLIDE}px)`,
          transition: dragging ? 'none' : `opacity ${open ? OPEN : CLOSE}, transform ${open ? OPEN : CLOSE}`,
        }}
        inert={!open || undefined}
      >
        {children}
      </div>
      {open && (
        <div
          className={`sb-rail${dragging ? ' on' : ''}`}
          style={{ left: w - 5 }}
          title="Drag to resize · click to hide (⌘B)"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { x: e.clientX, w, moved: false, collapse: false }
            setDragging(true)
          }}
          onPointerMove={(e) => {
            const d = drag.current
            if (!d) return
            const raw = d.w + e.clientX - d.x
            if (Math.abs(e.clientX - d.x) >= CLICK_PX) d.moved = true
            // Well past MIN: held at MIN, collapsing on release (pulled back, it isn't).
            d.collapse = raw < MIN - COLLAPSE_SLOP
            if (d.moved) setLive(Math.round(Math.min(MAX, Math.max(MIN, raw))))
          }}
          onPointerUp={(e) => {
            const d = drag.current
            drag.current = null
            setDragging(false)
            e.currentTarget.releasePointerCapture(e.pointerId)
            if (live !== null) store(live)
            setLive(null)
            if (d && (!d.moved || d.collapse)) setOpen(false)
          }}
          onPointerCancel={() => ((drag.current = null), setDragging(false), setLive(null))}
        />
      )}
    </div>
  )
}

/** The button that shows or hides it, for where the page's controls are */
export function SidebarToggle({ open, toggle }: { open: boolean; toggle: () => void }) {
  return (
    <button className="sb-toggle" title={`${open ? 'Hide' : 'Show'} sidebar (⌘B)`} aria-pressed={open} onClick={toggle}>
      <svg width={15} height={15} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4}>
        <rect x={1.75} y={2.25} width={12.5} height={11.5} rx={2} />
        <path d="M6 2.5v11" />
        {open && <path d="M3.5 5h1M3.5 7h1" strokeLinecap="round" />}
      </svg>
    </button>
  )
}
