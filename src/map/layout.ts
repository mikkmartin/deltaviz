/**
 * Layered layout: clusters ranked by their imports (importers above what they
 * import), and inside each cluster files ranked the same way. Good enough for
 * a few hundred modules without a layout library.
 */
import type { Graph, GraphEdge, GraphNode } from './model.js'

export const NODE_W = 150
export const NODE_H = 30
const GAP_X = 16
const GAP_Y = 40
const PAD = 18
const TITLE = 26
const CLUSTER_GAP = 26
const MAX_PER_ROW = 6

export interface Placed extends GraphNode {
  x: number
  y: number
}
export interface Box {
  name: string
  x: number
  y: number
  w: number
  h: number
}
export interface Wire extends GraphEdge {
  d: string
}
export interface Layout {
  nodes: Placed[]
  clusters: Box[]
  edges: Wire[]
  width: number
  height: number
}

/**
 * Longest path from a source (a node nothing points at). Cycles are cut at
 * their back edges, found by a DFS that starts from sources, then in input order.
 */
function ranks(ids: string[], edges: [string, string][]): Map<string, number> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]))
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const [s, t] of edges) {
    out.get(s)?.push(t)
    indegree.set(t, (indegree.get(t) ?? 0) + 1)
  }
  const kept: [string, string][] = []
  const state = new Map<string, 'open' | 'done'>()
  const dfs = (id: string) => {
    state.set(id, 'open')
    for (const t of out.get(id)!) {
      if (state.get(t) === 'open') continue // back edge
      kept.push([id, t])
      if (!state.has(t)) dfs(t)
    }
    state.set(id, 'done')
  }
  for (const id of [...ids.filter((id) => !indegree.get(id)), ...ids]) if (!state.has(id)) dfs(id)

  const into = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const [s, t] of kept) into.get(t)!.push(s)
  const rank = new Map<string, number>()
  const visit = (id: string): number => {
    const known = rank.get(id)
    if (known !== undefined) return known
    const r = Math.max(-1, ...into.get(id)!.map(visit)) + 1
    rank.set(id, r)
    return r
  }
  ids.forEach(visit)
  return rank
}

export function layout(g: Graph, maxWidth = 1600): Layout {
  const cluster = new Map(g.nodes.map((n) => [n.id, n.cluster]))
  const names = [...new Set(g.nodes.map((n) => n.cluster))].sort()
  const crossPairs = g.edges
    .map((e): [string, string] => [cluster.get(e.source)!, cluster.get(e.target)!])
    .filter(([a, b]) => a !== b)
  const clusterRank = ranks(names, crossPairs)

  // Inside each cluster: layers by rank, wide layers wrapped, ordered by the barycenter of their importers.
  const inner = new Map<string, { rows: GraphNode[][]; w: number; h: number }>()
  for (const name of names) {
    const members = g.nodes.filter((n) => n.cluster === name)
    const ids = new Set(members.map((n) => n.id))
    const intra = g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e): [string, string] => [e.source, e.target])
    const rank = ranks([...ids], intra)
    const layers: GraphNode[][] = []
    for (const n of members) (layers[rank.get(n.id)!] ??= []).push(n)
    const rows: GraphNode[][] = []
    const slot = new Map<string, number>()
    for (const layer of layers.filter(Boolean)) {
      const bary = (n: GraphNode) => {
        const xs = intra.filter(([, t]) => t === n.id).map(([s]) => slot.get(s)).filter((x): x is number => x !== undefined)
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Infinity
      }
      layer.sort((a, b) => bary(a) - bary(b) || a.id.localeCompare(b.id))
      for (let i = 0; i < layer.length; i += MAX_PER_ROW) {
        const row = layer.slice(i, i + MAX_PER_ROW)
        row.forEach((n, j) => slot.set(n.id, j - (row.length - 1) / 2))
        rows.push(row)
      }
    }
    const cols = Math.max(1, ...rows.map((r) => r.length))
    const titleW = name.length * 7 + PAD * 2
    inner.set(name, {
      rows,
      w: Math.max(cols * (NODE_W + GAP_X) - GAP_X + PAD * 2, titleW),
      h: rows.length * (NODE_H + GAP_Y) - GAP_Y + PAD * 2 + TITLE,
    })
  }

  // Clusters: one band per rank, wrapped at maxWidth.
  const clusters: Box[] = []
  const placed: Placed[] = []
  let y = 0
  let width = 0
  const bands = [...new Set(names.map((n) => clusterRank.get(n)!))].sort((a, b) => a - b)
  for (const band of bands) {
    let x = 0
    let bandH = 0
    for (const name of names.filter((n) => clusterRank.get(n) === band)) {
      const c = inner.get(name)!
      if (x > 0 && x + c.w > maxWidth) {
        y += bandH + CLUSTER_GAP
        x = 0
        bandH = 0
      }
      clusters.push({ name, x, y, w: c.w, h: c.h })
      c.rows.forEach((row, i) => {
        const offset = (c.w - PAD * 2 - (row.length * (NODE_W + GAP_X) - GAP_X)) / 2
        row.forEach((n, j) => placed.push({ ...n, x: x + PAD + offset + j * (NODE_W + GAP_X), y: y + TITLE + PAD + i * (NODE_H + GAP_Y) }))
      })
      x += c.w + CLUSTER_GAP
      bandH = Math.max(bandH, c.h)
      width = Math.max(width, x - CLUSTER_GAP)
    }
    y += bandH + CLUSTER_GAP
  }

  const at = new Map(placed.map((n) => [n.id, n]))
  const edges = g.edges.map((e): Wire => ({ ...e, d: wire(at.get(e.source)!, at.get(e.target)!) }))
  return { nodes: placed, clusters, edges, width, height: Math.max(0, y - CLUSTER_GAP) }
}

/** Downward edges leave the bottom and enter the top; anything else loops out sideways. */
function wire(s: Placed, t: Placed): string {
  const x1 = s.x + NODE_W / 2
  const y1 = s.y + NODE_H
  const x2 = t.x + NODE_W / 2
  const y2 = t.y
  if (y2 > y1 + 4) {
    const m = (y2 - y1) / 2
    return `M${x1},${y1}C${x1},${y1 + m} ${x2},${y2 - m} ${x2},${y2}`
  }
  const right = t.x >= s.x
  const sx = right ? s.x + NODE_W : s.x
  const tx = t.x === s.x ? t.x + NODE_W : right ? t.x : t.x + NODE_W
  const sy = s.y + NODE_H / 2
  const ty = t.y + NODE_H / 2
  const k = Math.max(50, Math.abs(tx - sx) / 2)
  const dir = right ? 1 : -1
  const back = t.x === s.x ? 1 : -dir
  return `M${sx},${sy}C${sx + k * dir},${sy} ${tx + k * back},${ty} ${tx},${ty}`
}
