/**
 * PROTOTYPE (throwaway): the npm packages a codebase imports, in the Tree: a `package.json`
 * section on the right of the code, a folder per kind (dependencies, devDependencies, …), each
 * package sized by what the code's imports of it add to a bundle. Not for main.
 */
import type { HierarchyRectangularNode } from 'd3-hierarchy'
import type { Graph, GraphNode, PackageEdge, PackageKind } from './model.js'
import type { TreeNode } from './tree.js'

/** A package and who imports it */
export interface PkgUse {
  name: string
  /** Files importing it now */
  files: Set<string>
  /** Files that started (added) or stopped (removed) importing it on this branch */
  added: number
  removed: number
  /** New to the branch (nothing imported it at the base) / dropped (nothing does now) */
  status: PackageEdge['status']
  /** A runtime dependency if any importer's package.json lists it as one */
  kind: PackageKind
}

export const KINDS: PackageKind[] = ['dep', 'dev', 'undeclared', 'builtin']
export const KIND_NAME: Record<PackageKind, string> = { dep: 'dependencies', dev: 'devDependencies', undeclared: 'undeclared', builtin: 'node builtins' }

export function packageUses(g: Graph): PkgUse[] {
  const by = new Map<string, PkgUse>()
  for (const e of g.packages ?? []) {
    const u = by.get(e.target) ?? { name: e.target, files: new Set(), added: 0, removed: 0, status: 'same', kind: e.kind }
    if (KINDS.indexOf(e.kind) < KINDS.indexOf(u.kind)) u.kind = e.kind
    if (e.status !== 'removed') u.files.add(e.source)
    if (e.status === 'added') u.added++
    if (e.status === 'removed') u.removed++
    by.set(e.target, u)
  }
  for (const u of by.values()) {
    const base = u.files.size - u.added + u.removed
    u.status = base === 0 ? 'added' : u.files.size === 0 ? 'removed' : 'same'
  }
  return [...by.values()].sort((a, b) => b.files.size - a.files.size || a.name.localeCompare(b.name))
}

/** The package.json section is darker than the code: its folders this far toward the canvas, its files barely filled */
export const PKG_DARKEN = 0.6
/** …and outlined brighter than the code, so its dark cells still read */
export const PKG_STROKE = 0.35

/**
 * The installed packages' folder: an id no file has (the root package.json is a file in
 * the tree too), shown titled after where they're declared.
 */
export const PKG_DIR = ':packages'
export const PKG_DIR_NAME = 'package.json'
/**
 * A package's area: the square root of its bundle size, from 1 KB up (see
 * docs/research/treemap-scaling.md). Bundle sizes span 4+ orders of magnitude; linear, the small
 * ones vanish. Labels and tooltips keep the real bytes; a key in the section's title says so.
 */
export const pkgArea = (bytes: number) => Math.sqrt(Math.max(bytes, 1024))
export const isPkgCell = (id: string) => id === PKG_DIR || id.startsWith(PKG_DIR + '/')
/** A package's cell */
export const pkgCellId = (u: PkgUse) => `${PKG_DIR}/${KIND_NAME[u.kind]}/${u.name}`

/**
 * Packages become files of a `package.json` folder, a subfolder per kind, and imports of them
 * edges. In lines (unused: the section is sized in bytes) each is as big as an average file per
 * √importers; in bytes, as what the code's imports of it add to a bundle.
 */
export function withPackageFolder(g: Graph): Graph {
  const uses = packageUses(g)
  if (!uses.length) return g
  const live = g.nodes.filter((n) => n.status !== 'removed')
  const avg = live.reduce((a, n) => a + (n.lines ?? 0), 0) / Math.max(1, live.length)
  const nodes: GraphNode[] = uses.map((u) => {
    const k = Math.sqrt(Math.max(1, u.files.size || u.removed))
    const lines = Math.max(1, Math.round(avg * k))
    // In bytes, a package is what the code's imports of it add to a bundle (nothing, for node's
    // builtins or one that isn't installed); its installed size is only in its tooltip.
    const bundled = g.packageBundle?.[u.name]
    const bytes = bundled?.bytes ?? 0
    return { id: pkgCellId(u), cluster: PKG_DIR, status: u.status, added: 0, deleted: 0, lines, baseLines: lines, bytes, baseBytes: bytes, ...(bundled && { bundled: { ...bundled, installed: g.packageBytes?.[u.name] } }) }
  })
  const kind = new Map(uses.map((u) => [u.name, u.kind]))
  const edges = (g.packages ?? []).map((e) => ({ source: e.source, target: `${PKG_DIR}/${KIND_NAME[kind.get(e.target)!]}/${e.target}`, status: e.status }))
  // The root package.json is the section itself: its header shows the file's changes.
  const pkgJson = g.nodes.find((n) => n.id === PKG_DIR_NAME)
  const own = g.nodes.filter((n) => n !== pkgJson)
  return { ...g, nodes: [...own, ...nodes], edges: [...g.edges, ...edges], pkgJson }
}

/**
 * The share of the width the packages section takes, always: its sizes (√bundle bytes) and the
 * code's (lines) don't compare, so its width carries no data.
 */
const SPLIT_SHARE = 0.2
/** Between the code and the packages, on top of the treemap's own gap (3px) */
export const SPLIT_GAP = 0

/** Squarifies a node's children in a box; `key` names the node (its code, beside packages, has its own) */
type Squarify = (key: string, node: HierarchyRectangularNode<TreeNode>, x0: number, y0: number, x1: number, y1: number) => void

/**
 * A treemap tiling that, at the top, puts `package.json` in a column on the right
 * (SPLIT_SHARE of the width) and
 * squarifies the rest in what's left (with `squarify`); below the top, squarified as usual.
 */
export const splitTile = (squarify: Squarify) => (node: HierarchyRectangularNode<TreeNode>, x0: number, y0: number, x1: number, y1: number) => {
  const pk = node.depth === 0 ? node.children?.find((c) => c.data.id === PKG_DIR) : undefined
  if (!pk) return squarify(node.data.id, node, x0, y0, x1, y1)
  const rest = node.children!.filter((c) => c !== pk)
  const xs = x1 - (x1 - x0) * SPLIT_SHARE
  const left = { children: rest, value: rest.reduce((a, c) => a + (c.value ?? 0), 0) } as unknown as HierarchyRectangularNode<TreeNode>
  if (rest.length) squarify(`${node.data.id}\n${PKG_DIR}`, left, x0, y0, xs - SPLIT_GAP / 2, y1)
  Object.assign(pk, { x0: xs + SPLIT_GAP / 2, y0, x1, y1 })
}
