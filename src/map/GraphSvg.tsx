/** Layered graph drawing for the diff view (positions from layout.ts). */
import { useMemo } from 'react'
import { NODE_H, NODE_W, type Layout, type Placed } from './layout.js'
import type { Pointer } from './pointer.js'
import { amber, green, red, gray } from '../palette.js'
import { T } from './theme.js'

/** The change colours, as the Tree's (theme.ts), for the Map, Summary and diff icons */
export const COLOR = { added: T.added, modified: T.modified, removed: T.removed, moved: T.moved, same: gray[600] }
const FILL = { added: green[950], modified: amber[950], removed: red[950], same: gray[900] }

/**
 * Imports arriving at a module through k different files: one trunk that frays
 * into k strands at the box. Through one entry point it stays a single clean line.
 */
export function frayPaths(s: Placed, t: Placed, k: number, d: string): string[] {
  const n = Math.min(k, 12)
  if (n <= 1) return [d]
  const x1 = s.x + NODE_W / 2
  const y1 = s.y + NODE_H
  const tx = t.x + NODE_W / 2
  if (t.y > y1 + 30) {
    // Downward: trunk to just above the box, then strands spread over its top edge.
    const jy = t.y - 18
    const m = (jy - y1) / 2
    const trunk = `M${x1},${y1}C${x1},${y1 + m} ${tx},${jy - m} ${tx},${jy}`
    const strands = Array.from({ length: n }, (_, i) => {
      const x = t.x + 10 + (i * (NODE_W - 20)) / (n - 1)
      return `M${tx},${jy}C${tx},${jy + 9} ${x},${t.y - 9} ${x},${t.y}`
    })
    return [trunk, ...strands]
  }
  // Sideways: the usual curve, plus strands fanning into the box's side.
  const right = t.x >= s.x
  const sx = right ? t.x : t.x + NODE_W
  const px = sx + (right ? -16 : 16)
  const py = t.y + NODE_H / 2
  return [
    d,
    ...Array.from({ length: n }, (_, i) => {
      const y = t.y + 4 + (i * (NODE_H - 8)) / (n - 1)
      return `M${px},${py}C${px + (right ? 8 : -8)},${py} ${sx + (right ? -6 : 6)},${y} ${sx},${y}`
    }),
  ]
}

export interface Extra {
  label?: (id: string) => string
  /** Small right-aligned text: file count, "+12" */
  note?: (id: string) => string
  /** Import count per "source\ntarget" */
  weight?: (source: string, target: string) => number
  /** Distinct files the imports land on (entry points used) */
  entries?: (source: string, target: string) => number
  folder?: (id: string) => boolean
  pill?: (id: string) => boolean
  clusterLabel?: (name: string) => string
  onNode?: (id: string) => void
  onCluster?: (name: string) => void
}

/**
 * `fit`: scaled down to the container's width (never up), for the mini map.
 * `hover`: a file or folder, from here or outside (the Summary); a file drawn inside a folder node lights that node.
 */
export function GraphSvg(props: Pick<Pointer, 'hover' | 'onHover'> & { layout: Layout; extra: Extra; fit?: boolean }) {
  const { layout: L, extra, fit, onHover: setHover } = props
  const at = useMemo(() => new Map(L.nodes.map((n) => [n.id, n])), [L])
  const hover = props.hover === null || at.has(props.hover) ? props.hover : (L.nodes.find((n) => props.hover!.startsWith(n.id + '/'))?.id ?? null)
  const linked = useMemo(() => {
    if (!hover) return null
    const ids = new Set([hover])
    for (const e of L.edges) if (e.source === hover || e.target === hover) ids.add(e.source).add(e.target)
    return ids
  }, [hover, L])
  return (
    <svg
      width={fit ? undefined : L.width + 40}
      height={fit ? undefined : L.height + 40}
      viewBox={`-20 -20 ${L.width + 40} ${L.height + 40}`}
      style={fit ? { display: 'block', width: '100%', maxWidth: L.width + 40, height: 'auto' } : { display: 'block' }}
    >
      {L.clusters.map((c) => (
        <g key={c.name} onClick={() => extra.onCluster?.(c.name)} style={{ cursor: extra.onCluster ? 'pointer' : undefined }}>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={10} fill={gray[900]} stroke={gray[800]} />
          <text x={c.x + 16} y={c.y + 20} fill={gray[500]} fontSize={11} fontWeight={600}>
            {extra.clusterLabel ? extra.clusterLabel(c.name) : c.name}
          </text>
        </g>
      ))}
      {L.edges.map((e) => {
        const w = extra.weight?.(e.source, e.target) ?? 1
        const lit = hover && (e.source === hover || e.target === hover)
        const quiet = e.status === 'same'
        return (
          <g key={`${e.source}>${e.target}`} fill="none" stroke={quiet && lit ? gray[400] : COLOR[e.status]} strokeDasharray={e.status === 'removed' ? '5 4' : undefined} opacity={linked ? (lit ? 1 : 0.05) : quiet ? 0.5 : 1}>
            {frayPaths(at.get(e.source)!, at.get(e.target)!, extra.entries?.(e.source, e.target) ?? 1, e.d).map((d, i) => (
              <path key={i} d={d} strokeWidth={i === 0 ? Math.min(7, (quiet ? 0.9 : 1.6) + Math.log2(w) * 0.9) : 0.8} />
            ))}
          </g>
        )
      })}
      {L.nodes.map((n) => {
        const folder = extra.folder?.(n.id)
        const pill = extra.pill?.(n.id)
        const label = extra.label ? extra.label(n.id) : n.id.slice(n.id.lastIndexOf('/') + 1)
        const note = extra.note?.(n.id)
        const room = note ? Math.max(8, 20 - Math.ceil(note.length * 0.95)) : 19
        return (
          <g
            key={n.id}
            transform={`translate(${n.x},${n.y})`}
            opacity={linked && !linked.has(n.id) ? 0.2 : 1}
            onMouseEnter={() => setHover(n.id)}
            onMouseLeave={() => setHover(null)}
            onClick={() => extra.onNode?.(n.id)}
            style={{ cursor: extra.onNode && (folder || pill || n.status !== 'same') ? 'pointer' : undefined }}
          >
            <title>{`${n.id}\n${n.status}  +${n.added} −${n.deleted}`}</title>
            <rect
              width={NODE_W}
              height={NODE_H}
              rx={pill ? NODE_H / 2 : 6}
              fill={pill ? 'transparent' : FILL[n.status]}
              stroke={n.status === 'same' ? (pill ? gray[600] : gray[700]) : COLOR[n.status]}
              strokeDasharray={n.status === 'removed' || pill ? '4 3' : undefined}
            />
            {folder && <rect width={4} height={NODE_H} rx={2} fill={n.status === 'same' ? gray[700] : COLOR[n.status]} />}
            <text
              x={10}
              y={NODE_H / 2 + 4}
              fill={pill ? gray[400] : n.status === 'same' ? gray[400] : gray[200]}
              fontSize={11}
              fontWeight={folder ? 600 : 400}
              fontFamily="ui-monospace, monospace"
            >
              {label.length > room ? '…' + label.slice(-(room - 1)) : label}
            </text>
            {note && (
              <text x={NODE_W - 8} y={NODE_H / 2 + 4} textAnchor="end" fill={gray[500]} fontSize={10} fontFamily="ui-monospace, monospace">
                {note}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
