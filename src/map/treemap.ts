/**
 * The Tree laid out as a treemap: what's drawn where, for a folder zoomed into at a size.
 * Hides d3, the padding and corners, the package.json split, and each folder's arrangement,
 * remembered across zooms so a folder zoomed into (or back out to) keeps its boxes where they were.
 */
import { hierarchy, treemap, treemapResquarify } from 'd3-hierarchy'
import { hasHeader, HEADER, renamedAway, type R } from './cell.js'
import { isPkgCell, pkgArea, splitTile } from './packages.prototype.js'
import type { TreeNode } from './tree.js'

/** Corners of every cell */
export const RADIUS = 6
/** Inside a folder, round what it holds (under its name row, when it has one) */
const PAD = 2
/** Between cells in a folder */
const GAP = 3

/** One view of the treemap */
export interface Layout {
  /** The folder zoomed into: the canvas, at depth 0 */
  top: TreeNode
  laid: R
  /** Every drawn cell, by id */
  cells: Map<string, R>
  /** Each cell's corner radius */
  radius: Map<string, number>
  /** How deep the folders go in this view (1 at least) */
  deepest: number
  /**
   * The cell `t` is drawn in: its own, else its nearest drawn ancestor's that `accept` takes
   * (the top's, when nothing nearer is). Undefined when it isn't in this view.
   */
  cellOf(t: TreeNode | null | undefined, accept?: (c: R) => boolean): R | undefined
}

export interface Treemap {
  /** `top` laid out in W×H; a folder keeps its arrangement from earlier layouts at much the same shape */
  layout(top: TreeNode, W: number, H: number): Layout
}

/** How far the canvas's shape (W/H) may drift before folders are laid out afresh: the bar above it changes height as you zoom */
const RESHAPE = 1.2

/** A treemap that remembers each folder's arrangement until the canvas's shape changes much (a first layout at a passing size would stick) */
export function createTreemap(): Treemap {
  let shape = 0
  let memory: Arrangements = new Map()
  return {
    layout(top, W, H) {
      const r = W / H
      if (!shape || Math.max(r / shape, shape / r) > RESHAPE) (shape = r), (memory = new Map())
      return lay(top, W, H, memory)
    },
  }
}

/** Area a cell gets: lines (as at the base, for a deleted file); PROTOTYPE: a package, √ of its bundle bytes */
const value = (n: TreeNode) =>
  n.file ? (isPkgCell(n.id) ? pkgArea(n.bytes) : Math.max(1, n.file.status === 'removed' ? n.baseLines : n.lines)) : 0

function lay(top: TreeNode, W: number, H: number, memory: Arrangements): Layout {
  const h = hierarchy(top, (n) => (n.file ? null : n.children.filter((c) => !renamedAway(c))))
    .sum(value)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  // Folders pad what they hold, under a row for the name; the zoomed-in one is the canvas, unpadded.
  const pad = (d: { depth: number }) => (d.depth > 0 ? PAD : 0)
  const laid = treemap<TreeNode>()
    // PROTOTYPE: installed packages get their own column.
    .tile(splitTile((key, ...a) => stableSquarify(memory, key, ...a)))
    .size([W, H])
    .paddingTop((d) => (hasHeader(d as R) ? HEADER : pad(d)))
    .paddingLeft(pad)
    .paddingRight(pad)
    .paddingBottom(pad)
    .paddingInner(GAP)(h)
  const cells = new Map<string, R>()
  const radius = new Map<string, number>()
  let deepest = 1
  laid.each((d) => {
    cells.set(d.data.id, d)
    // Two steps, so neighbours' corners match: small cells stay boxes, not pills.
    const side = Math.min(d.x1 - d.x0, d.y1 - d.y0)
    radius.set(d.data.id, d.depth === 0 ? 0 : side >= 4 * RADIUS ? RADIUS : Math.min(2, side / 4))
    if (!d.data.file) deepest = Math.max(deepest, d.depth)
  })
  const cellOf = (t: TreeNode | null | undefined, accept: (c: R) => boolean = () => true) => {
    for (; t; t = t.parent) {
      const c = cells.get(t.id)
      if (c && accept(c)) return c
    }
  }
  return { top, laid, cells, radius, deepest, cellOf }
}

/** A folder's squarified rows: which children each holds, in order, and which way it runs */
type Row = { dice: boolean; ids: string[] }
/** Rows as d3's resquarify keeps them on a node */
type D3Rows = { value: number; dice: boolean; children: R[] }[] & { ratio?: number }
/** Each folder's rows, and the shape (w/h) of the box they were made for */
type Arrangements = Map<string, { shape: number; rows: Row[] }>
/**
 * How far a folder's own shape may stretch from the box its rows were made for and keep them
 * (zoomed into, a tall folder fills a wide canvas). Past it, its cells would be slivers: laid out afresh.
 */
const STRETCH = 6

const PHI = (1 + Math.sqrt(5)) / 2

/**
 * Squarify `node`'s children in the box, as `memory` has them under `key` when it holds the same
 * children (their shares follow today's values, as d3's resquarify); else afresh, remembered.
 * Zoomed into, a folder keeps the rows it had in the view above, stretched to the canvas.
 * Reaches into d3's private `_squarify`, where resquarify keeps a node's rows.
 */
function stableSquarify(memory: Arrangements, key: string, node: R, x0: number, y0: number, x1: number, y1: number) {
  const kids = node.children ?? []
  const shape = (x1 - x0) / Math.max(1e-9, y1 - y0)
  const kept = memory.get(key)
  const known = kept && Math.max(shape / kept.shape, kept.shape / shape) <= STRETCH ? kept.rows : undefined
  const at = new Map(kids.map((c) => [c.data.id, c]))
  const same = known && known.reduce((n, r) => n + r.ids.length, 0) === kids.length && known.every((r) => r.ids.every((id) => at.has(id)))
  const self = node as R & { _squarify?: D3Rows }
  if (same) {
    const rows: D3Rows = known.map((r) => ({ value: 0, dice: r.dice, children: r.ids.map((id) => at.get(id)!) }))
    rows.ratio = PHI
    self._squarify = rows
  } else delete self._squarify
  treemapResquarify(node, x0, y0, x1, y1)
  if (!same && self._squarify) memory.set(key, { shape, rows: self._squarify.map((r) => ({ dice: r.dice, ids: r.children.map((c) => c.data.id) })) })
}
