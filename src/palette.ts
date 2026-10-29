/**
 * The overlay's colours, for the dock, panels and plugins: Tailwind's palette (v3
 * hex), gray for the neutrals. `alpha` is Tailwind's `/opacity`: alpha(gray[200], 0.16)
 * is gray-200/16.
 */
export const white = '#ffffff'
export const black = '#000000'
export const gray = {
  200: '#e5e7eb',
  300: '#d1d5db',
  400: '#9ca3af',
  500: '#6b7280',
  600: '#4b5563',
  700: '#374151',
  800: '#1f2937',
  900: '#111827',
  950: '#030712',
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
