/**
 * The overlay's colours, for the dock, panels and plugins: Tailwind's palette (v3
 * hex), its `zinc` scale for the neutrals (as `gray`): barely cool, so the
 * amber of edited files doesn't turn brown on it (as on pure `neutral`), nor blue (as on `gray`). `alpha` is Tailwind's `/opacity`: alpha(gray[200], 0.16)
 * is gray-200/16.
 */
export const white = '#ffffff'
export const black = '#000000'
export const gray = {
  200: '#e4e4e7',
  300: '#d4d4d8',
  400: '#a1a1aa',
  500: '#71717a',
  600: '#52525b',
  700: '#3f3f46',
  800: '#27272a',
  900: '#18181b',
  950: '#09090b',
}
export const green = { 400: '#4ade80', 500: '#22c55e', 600: '#16a34a', 700: '#15803d', 950: '#052e16' }
export const amber = { 500: '#f59e0b', 950: '#451a03' }
export const red = { 400: '#f87171', 500: '#ef4444', 600: '#dc2626', 950: '#450a0a' }
export const blue = { 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb' }
export const violet = { 400: '#a78bfa' }

export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/** A solid colour `t` of the way from `a` to `b` (both #rrggbb) */
export function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)
  return `rgb(${[0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t)).join(', ')})`
}

/** Every font: Geist Mono (served with the page, see cli.ts), else the system's monospace */
export const MONO = "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

/** The UI's accent: what's on (switches), focus rings, the sidebar's rail, links */
export const ACCENT = '#05df72'
