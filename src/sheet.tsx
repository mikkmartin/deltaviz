import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { alpha, black, gray, white } from './palette.js'

/**
 * A panel over the page from its right edge, after shadcn's Sheet (side="right"), quicker and
 * without its blur: a dimming overlay, the panel fading in from a little (SLIDE) out, and back out the same way on close.
 * Escape, a click on the overlay, or its ✕ closes it; it's gone (`onClose`) once it has left.
 */

/** The panel's in and out (the overlay's is quicker) */
const MS = 120
const OVERLAY_MS = 100
/** How far the panel travels in and out: little, it's mostly a fade (shadcn's 2.5rem was too much) */
const SLIDE = 8
/** The longest it waits for its content to settle before coming in anyway */
const READY_WAIT_MS = 150

export const SHEET_CSS = `
.sheet-overlay { position: fixed; inset: 0; z-index: 10; background: ${alpha(black, 0.55)}; transition: opacity ${OVERLAY_MS}ms; }
.sheet { position: fixed; z-index: 11; top: 0; bottom: 0; right: 0; width: 75%; max-width: 1100px; display: flex; flex-direction: column;
  background: ${gray[950]}; border-left: 1px solid ${gray[800]}; box-shadow: 0 10px 15px -3px ${alpha(black, 0.4)}, 0 4px 6px -4px ${alpha(black, 0.4)};
  transition: opacity ${MS}ms ease-in-out, transform ${MS}ms ease-in-out; outline: none; }
.sheet-overlay.out, .sheet.out { opacity: 0; }
.sheet.out { transform: translateX(${SLIDE}px); }
/* One row, everything centred on it: the badge, the name over its description, the counts, ✕ */
.sheet-head { display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 0 12px 0 20px; box-sizing: border-box; }
.sheet-names { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0; padding: 12px 0; }
.sheet-title { font-size: 14px; line-height: 18px; color: ${white}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sheet-desc { font-size: 12px; line-height: 16px; color: ${gray[400]}; }
/* Toned (a changed file, in its change's colour, --tone): as an editor's status bar, a solid block with the badge, then the bar tinted, its text in the colour */
.sheet-head.toned { padding-left: 0; gap: 16px; background: color-mix(in srgb, var(--tone) 10%, transparent); }
.sheet-head.toned .sheet-title, .sheet-head.toned .sheet-desc { color: var(--tone); }
.sheet-head.toned .sheet-desc { opacity: 0.75; }
.sheet-badge { flex: none; align-self: stretch; width: 48px; display: flex; align-items: center; justify-content: center; background: var(--tone); color: ${gray[950]}; }
.sheet-close { all: unset; flex: none; width: 28px; height: 28px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; color: ${gray[400]}; cursor: pointer; }
.sheet-close:hover { background: ${gray[800]}; color: ${white}; }
.sheet-close:focus-visible { outline: 2px solid ${gray[500]}; }
.sheet-head.toned .sheet-close { color: var(--tone); }
.sheet-head.toned .sheet-close:hover { background: color-mix(in srgb, var(--tone) 18%, transparent); color: var(--tone); }
.sheet-body { flex: 1; min-height: 0; overflow: auto; }
@media (prefers-reduced-motion: reduce) { .sheet, .sheet-overlay { transition: none; } }
`

export function Sheet({ title, description, aside, badge, tone, onClose, ready = true, children }: { title: ReactNode; description?: ReactNode; aside?: ReactNode; /** A status block at the header's start, in `tone`: the header takes that tone (a changed file's colour) */ badge?: ReactNode; tone?: string; onClose(): void; /** Whether what it shows has settled: it comes in only then (or after READY_WAIT_MS), so nothing changes size as it slides */ ready?: boolean; children: ReactNode }) {
  /** Off (faded, shifted): mounting, till the first frame's drawn, and leaving */
  const [out, setOut] = useState(true)
  const leaving = useRef(false)
  const panel = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    if (leaving.current) return
    leaving.current = true
    setOut(true)
    setTimeout(onClose, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : MS)
  }, [onClose])
  useLayoutEffect(() => {
    const before = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => void before?.focus?.()
  }, [])
  // In once its content has settled (laid out, unseen, meanwhile), or anyway after a moment.
  const entered = useRef(false)
  useEffect(() => {
    if (entered.current) return
    const enter = () => {
      if (entered.current || leaving.current) return
      entered.current = true
      // Its off state applied (a forced style read), whether or not a frame showed it: the change to on transitions.
      void panel.current?.offsetWidth
      setOut(false)
    }
    if (!ready) {
      const t = setTimeout(enter, READY_WAIT_MS)
      return () => clearTimeout(t)
    }
    // Drawn off first (effects run after the paint), then on the next frame: the transition runs.
    const id = requestAnimationFrame(enter)
    return () => cancelAnimationFrame(id)
  }, [ready])
  useEffect(() => {
    // Capture: ahead of anything else Escape would do.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return void (e.stopImmediatePropagation(), close())
      // Modal: Tab cycles within the panel, never to the page under it.
      const p = panel.current
      if (e.key !== 'Tab' || !p) return
      const all = [...p.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      const [first, last] = [all[0], all[all.length - 1]]
      const at = document.activeElement
      if (!first || !last) return void (e.preventDefault(), p.focus())
      if (!p.contains(at)) return void (e.preventDefault(), first.focus())
      if (e.shiftKey && (at === first || at === p)) return void (e.preventDefault(), last.focus())
      if (!e.shiftKey && at === last) return void (e.preventDefault(), first.focus())
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [close])
  return (
    <>
      <div className={`sheet-overlay${out ? ' out' : ''}`} onClick={close} />
      <div className={`sheet${out ? ' out' : ''}`} role="dialog" aria-modal="true" tabIndex={-1} ref={panel}>
        <div className={`sheet-head${badge && tone ? ' toned' : ''}`} style={tone ? ({ '--tone': tone } as CSSProperties) : undefined}>
          {badge && <div className="sheet-badge">{badge}</div>}
          <div className="sheet-names">
            <div className="sheet-title">{title}</div>
            {description && <div className="sheet-desc">{description}</div>}
          </div>
          {aside}
          <button className="sheet-close" title="Close (Esc)" aria-label="Close" onClick={close}>
            <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  )
}
