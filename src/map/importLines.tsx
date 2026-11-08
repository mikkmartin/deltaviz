/** The hovered file's or folder's imports, drawn over the Tree. */
import { alpha, black, MONO, white } from '../palette.js'
import { useId } from 'react'
import type { R } from './cell.js'
import type { Status } from './model.js'
import { T } from './theme.js'

/** Imports between the hovered cell and one other, `n` of them, `out` when the hovered one imports */
export type Link = { from: R; to: R; out: boolean; n: number; status: Exclude<Status, 'modified'> }

type Part = { n: number; color: string }
type Point = { x: number; y: number }

export const centre = (c: R): Point => ({ x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2 })
/** A hovered file box smaller than this (its shorter side) is kept clear of its lines */
const CLEAR_BELOW = 20
const colorOf = (l: Link) => (l.status === 'added' ? T.added : l.status === 'removed' ? T.removed : l.out ? T.importOut : T.importIn)

/** Counts per direction and colour, imports above importers; the colour most of them are drawn in */
function tally(ls: Link[]): { parts: Part[]; color: string } {
  const parts = new Map<string, Part>()
  for (const l of [...ls].sort((a, b) => Number(b.out) - Number(a.out))) {
    const key = `${l.out}:${colorOf(l)}`
    const p = parts.get(key) ?? { n: 0, color: colorOf(l) }
    p.n += l.n
    parts.set(key, p)
  }
  const weight = new Map<string, number>()
  for (const p of parts.values()) weight.set(p.color, (weight.get(p.color) ?? 0) + p.n)
  return { parts: [...parts.values()], color: [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? T.text }
}

/** Counts in rows, centred on (x, y), each in its colour */
function Rows({ x, y, parts, size }: { x: number; y: number; parts: Part[]; size: number }) {
  const line = size * 1.05
  const top = y - ((parts.length - 1) * line) / 2 + size * 0.35
  return (
    <text textAnchor="middle" fontSize={size} fontFamily={MONO}>
      {parts.map((p, i) => (
        <tspan key={i} x={x} y={top + i * line} fill={p.color}>
          {p.n}
        </tspan>
      ))}
    </text>
  )
}

/**
 * A ring: dark inside, its counts bigger the more imports, but kept inside with room around
 * them (the block's corners within three quarters of the radius, inside the stroke).
 */
function Ring({ at, r, stroke, color, parts, shade }: { at: Point; r: number; stroke: number; color: string; parts: Part[]; shade: number }) {
  const total = parts.reduce((a, p) => a + p.n, 0)
  const widest = Math.max(...parts.map((p) => String(p.n).length))
  // The block per unit of font size: monospace digits ~0.6em wide, rows 1.05em apart, ~0.75em tall.
  const halfW = 0.3 * widest
  const halfH = ((parts.length - 1) * 1.05 + 0.75) / 2
  const room = Math.max(0, 0.75 * (r - stroke / 2))
  const size = Math.min(9 + 3 * Math.sqrt(total), room / Math.hypot(halfW, halfH))
  return (
    <>
      <circle cx={at.x} cy={at.y} r={r} fill={alpha(T.shade, shade)} />
      <circle cx={at.x} cy={at.y} r={r} fill="none" stroke={color} strokeWidth={stroke} />
      <Rows x={at.x} y={at.y} parts={parts} size={size} />
    </>
  )
}

/** A file's counts where a folder's lines end at it: a small rounded box, in rows like a ring's */
function Badge({ at, parts, color }: { at: Point; parts: Part[]; color: string }) {
  const widest = Math.max(...parts.map((p) => String(p.n).length))
  const w = Math.max(16, widest * 5.3 + 8)
  const h = parts.length * 9 + 7
  return (
    <>
      <rect x={at.x - w / 2} y={at.y - h / 2} width={w} height={h} rx={Math.min(8, h / 2)} fill={alpha(T.shade, 0.6)} stroke={color} strokeWidth={1.5} />
      <Rows x={at.x} y={at.y} parts={parts} size={8.5} />
    </>
  )
}

/** The cubic for a quadratic arc from `a` to `b` bending through `m` (its tangent at each end points at m) */
const viaArc = (a: Point, m: Point, b: Point): [Point, Point] => [
  { x: a.x + (2 / 3) * (m.x - a.x), y: a.y + (2 / 3) * (m.y - a.y) },
  { x: b.x + (2 / 3) * (m.x - b.x), y: b.y + (2 / 3) * (m.y - b.y) },
]

/**
 * The hovered item's imports, importers and those this branch added or dropped (green, red;
 * dropped ones dashed). From a file: lines from a small ring on it to dots on the others.
 * From a folder: lines run from a ring sized to the folder (it stands for all of it, not a
 * point in it), in the colour most of them are, to one ring per other folder sized by the
 * imports it takes, its imports and importers counted in rows inside (or to a file's
 * centre, the counts there). Every line first, then every ring and dot over them. A small
 * hovered file's box (corner radius `radius`) is kept clear instead: its lines start at its edge.
 */
export function ImportLines({ links, from, radius }: { links: Link[]; from: R; radius: number }) {
  const mask = useId()
  const o = centre(from)
  const folder = !from.data.file
  const clear = !folder && Math.min(from.x1 - from.x0, from.y1 - from.y0) < CLEAR_BELOW
  /** A folder's ring: sized to it, standing for all of it */
  const ringOf = (c: R) => (c.data.file ? 0 : Math.max(6, Math.min(c.x1 - c.x0, c.y1 - c.y0) * 0.3))
  /** A hovered file's ring: small, it marks where its lines start, not an amount (none when its box is kept clear) */
  const ring = folder ? ringOf(from) : clear ? 0 : 5
  /** A folder's lines thicken with the imports they bundle; a ring is as thick as its thickest. */
  const width = (l: Link) => (folder ? Math.min(6, 1 + Math.log2(l.n)) : 1)
  const targets = new Map<string, Link[]>()
  for (const l of links) targets.set(l.to.data.id, [...(targets.get(l.to.data.id) ?? []), l])
  const drawn = [...targets.values()].map((group) => {
    const target = group[0].to
    const to = centre(target)
    const total = group.reduce((a, l) => a + l.n, 0)
    // A target folder's ring grows with the imports it takes, up to its own size.
    // From a file, only it gets a ring; its lines end at the other files' centres, in a dot.
    const toRing = folder && !target.data.file ? Math.min(ringOf(target), 8 + 5 * Math.sqrt(total)) : 0
    const base = Math.atan2(to.y - o.y, to.x - o.x)
    const ends: (Point & { color: string })[] = []
    const lines = group.map((l, i) => {
      // Lines to the same target fan out a little at both ends, so they run side by side.
      const spread = group.length > 1 ? (i - (group.length - 1) / 2) * 0.25 : 0
      let start: Point
      let end: Point
      let c1: Point
      let c2: Point
      if (folder) {
        // A gentle arc from ring to ring, as a cubic whose handle at a ring points along its
        // radius: the line meets the ring head-on, in line with its centre.
        const a0 = base + spread
        const a1 = base + Math.PI - spread
        start = { x: o.x + Math.cos(a0) * ring, y: o.y + Math.sin(a0) * ring }
        end = { x: to.x + Math.cos(a1) * toRing, y: to.y + Math.sin(a1) * toRing }
        const m = { x: (start.x + end.x) / 2 - (end.y - start.y) * 0.2, y: (start.y + end.y) / 2 + (end.x - start.x) * 0.2 }
        const radial = (p: Point, angle: number) => {
          const reach = (2 / 3) * Math.hypot(m.x - p.x, m.y - p.y)
          return { x: p.x + Math.cos(angle) * reach, y: p.y + Math.sin(angle) * reach }
        }
        const arc = viaArc(start, m, end)
        c1 = radial(start, a0)
        c2 = toRing ? radial(end, a1) : arc[1]
      } else {
        // A file's arc is laid out between the centres; it starts where it crosses the small
        // ring heading for its bend, so it points at the ring's centre.
        const bend = 0.2 + spread
        const m = { x: (o.x + to.x) / 2 - (to.y - o.y) * bend, y: (o.y + to.y) / 2 + (to.x - o.x) * bend }
        const len = Math.hypot(m.x - o.x, m.y - o.y) || 1
        start = { x: o.x + ((m.x - o.x) / len) * ring, y: o.y + ((m.y - o.y) / len) * ring }
        end = to
        ;[c1, c2] = viaArc(start, m, end)
      }
      if (!toRing && (!folder || total === 1)) ends.push({ ...end, color: colorOf(l) })
      return (
        <path
          key={String(l.out)}
          d={`M${start.x},${start.y}C${c1.x},${c1.y} ${c2.x},${c2.y} ${end.x},${end.y}`}
          fill="none"
          stroke={colorOf(l)}
          strokeWidth={width(l)}
          strokeLinecap="round"
          strokeDasharray={l.status === 'removed' ? `${width(l) * 2.5} ${width(l) * 2.5 + 3}` : undefined}
        />
      )
    })
    const { parts, color } = tally(group)
    const marks = (
      <>
        {ends.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={p.color} />
        ))}
        {toRing > 0 ? (
          // Dark inside, so the counts read over whatever the folder holds there.
          <Ring at={to} r={toRing} stroke={Math.max(...group.map(width))} color={color} parts={parts} shade={0.6} />
        ) : folder && total > 1 ? (
          <Badge at={to} parts={parts} color={color} />
        ) : null}
      </>
    )
    return { key: target.data.id, lines, marks }
  })
  const all = tally(links)
  return (
    <g pointerEvents="none">
      {clear && (
        <mask id={mask} maskUnits="userSpaceOnUse" x={-1e5} y={-1e5} width={2e5} height={2e5}>
          <rect x={-1e5} y={-1e5} width={2e5} height={2e5} fill={white} />
          <rect x={from.x0} y={from.y0} width={from.x1 - from.x0} height={from.y1 - from.y0} rx={radius} fill={black} />
        </mask>
      )}
      <g mask={clear ? `url(#${CSS.escape(mask)})` : undefined}>
        {drawn.map((d) => (
          <g key={d.key}>{d.lines}</g>
        ))}
      </g>
      {drawn.map((d) => (
        <g key={d.key}>{d.marks}</g>
      ))}
      {folder ? (
        <Ring at={o} r={ring} stroke={Math.max(...links.map(width))} color={all.color} parts={all.parts} shade={0.3} />
      ) : (
        !clear && (
          <>
            <circle cx={o.x} cy={o.y} r={ring} fill={alpha(T.shade, 0.6)} />
            <circle cx={o.x} cy={o.y} r={ring} fill="none" stroke={T.hover} strokeWidth={2} />
          </>
        )
      )}
    </g>
  )
}
