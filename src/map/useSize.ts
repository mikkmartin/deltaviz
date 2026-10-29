import { useEffect, useState } from 'react'

/**
 * Content size of an element, kept current with a ResizeObserver. Returns a
 * callback ref, so it follows the element even when it mounts late.
 */
export function useSize(): [(el: HTMLElement | null) => void, { width: number; height: number }] {
  const [el, setEl] = useState<HTMLElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, size]
}
