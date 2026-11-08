import { useLayoutEffect, useRef, useState } from 'react'
import { ACCENT, alpha, gray, white } from './palette.js'

/**
 * Tabs after Fluid Functionalism's (fluidfunctionalism.com/docs/tabs): a pill under the selected
 * tab that glides to the next one, on a faint ground for the group. Hovering lights only the
 * label (no hover pill). Arrows move focus, Enter or Space selects (manual activation), as a
 * tablist. The weights stay as they are (the page has no bold): the selected label is just brighter.
 */

/** The source's `moderate` motion tier (critically damped), to glide */
const MODERATE = '160ms cubic-bezier(.22, 1, .36, 1)'

/** The pills' corners, and the group's inset around them */
const RADIUS = 6
export const TABS_INSET = 2
const INSET = TABS_INSET

export const TABS_CSS = `
/* The group: a faint ground, its corners concentric with the pills' (their radius plus the inset) */
.tabs { position: relative; display: inline-flex; align-items: center; user-select: none; padding: ${INSET}px; border-radius: ${RADIUS + INSET}px; background: ${alpha(white, 0.04)}; }
.tabs-pill { position: absolute; top: ${INSET}px; bottom: ${INSET}px; border-radius: ${RADIUS}px; background: ${gray[700]}; pointer-events: none; }
.tabs button { all: unset; position: relative; z-index: 1; cursor: pointer; padding: 3px 12px; border-radius: ${RADIUS}px; font-size: 12px; color: ${gray[400]}; transition: color 80ms; }
.tabs button:hover, .tabs button[aria-selected="true"] { color: ${gray[200]}; }
.tabs button:focus-visible { outline: 1px solid ${ACCENT}; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .tabs-pill { transition: none !important; } }
`

type Rect = { left: number; width: number }

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { value: T; label: string; title?: string }[]; value: T; onChange(v: T): void; label?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const [rects, setRects] = useState<Rect[]>([])
  const selected = Math.max(0, tabs.findIndex((t) => t.value === value))

  // Where each tab is, kept current (labels, fonts and the bar's wrapping move them).
  useLayoutEffect(() => {
    const measure = () => setRects(refs.current.map((el) => (el ? { left: el.offsetLeft, width: el.offsetWidth } : { left: 0, width: 0 })))
    measure()
    const ro = new ResizeObserver(measure)
    refs.current.forEach((el) => el && ro.observe(el))
    document.fonts?.ready.then(measure)
    return () => ro.disconnect()
  }, [tabs.length])

  const sel = rects[selected]

  const focus = (i: number) => refs.current[(i + tabs.length) % tabs.length]?.focus()
  return (
    <div
      className="tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        const at = refs.current.indexOf(document.activeElement as HTMLButtonElement)
        if (at < 0) return
        const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key]
        if (to === undefined) return
        e.preventDefault()
        focus(to)
      }}
    >
      {sel && <div className="tabs-pill" style={{ left: sel.left, width: sel.width, transition: `left ${MODERATE}, width ${MODERATE}` }} />}
      {tabs.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => void (refs.current[i] = el)}
          role="tab"
          aria-selected={i === selected}
          tabIndex={i === selected ? 0 : -1}
          title={t.title}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
