/** Folder tree over the file graph: sizes and changes rolled up per folder. */
import type { Graph, GraphNode } from './model.js'
import { PKG_DIR, PKG_DIR_NAME } from './packages.js'

export interface TreeNode {
  /** Folder path or file path */
  id: string
  /** Display name; single-child folder chains are merged (apps/web/src) */
  name: string
  parent: TreeNode | null
  children: TreeNode[]
  file: GraphNode | null
  files: number
  changed: number
  added: number
  deleted: number
  depth: number
  /** Lines of code, now and at the base */
  lines: number
  baseLines: number
  /** Size on disk, now and at the base */
  bytes: number
  baseBytes: number
}

export function buildTree(g: Graph): { root: TreeNode; byId: Map<string, TreeNode> } {
  const blank = { files: 0, changed: 0, added: 0, deleted: 0, depth: 0, lines: 0, baseLines: 0, bytes: 0, baseBytes: 0 }
  const root: TreeNode = { id: '', name: '(repo)', parent: null, children: [], file: null, ...blank }
  const dirs = new Map<string, TreeNode>([['', root]])
  const dir = (path: string): TreeNode => {
    const known = dirs.get(path)
    if (known) return known
    const cut = path.lastIndexOf('/')
    const parent = dir(cut === -1 ? '' : path.slice(0, cut))
    const node: TreeNode = { id: path, name: path === PKG_DIR ? PKG_DIR_NAME : path.slice(cut + 1), parent, children: [], file: null, ...blank }
    parent.children.push(node)
    dirs.set(path, node)
    return node
  }
  for (const n of g.nodes) {
    const cut = n.id.lastIndexOf('/')
    const parent = dir(cut === -1 ? '' : n.id.slice(0, cut))
    parent.children.push({ id: n.id, name: n.id.slice(cut + 1), parent, children: [], file: n, ...blank, files: 1 })
  }
  // Merge chains: a folder whose only child is a folder.
  const merge = (n: TreeNode) => {
    for (let i = 0; i < n.children.length; i++) {
      let c = n.children[i]
      while (!c.file && c.children.length === 1 && !c.children[0].file) {
        const only = c.children[0]
        only.name = `${c.name}/${only.name}`
        only.parent = n
        c = only
      }
      n.children[i] = c
      merge(c)
    }
  }
  merge(root)
  const byId = new Map<string, TreeNode>()
  const sum = (n: TreeNode, depth: number) => {
    n.depth = depth
    byId.set(n.id, n)
    if (n.file) {
      // A moved file's old spot is the same file: it counts once, where it is now.
      if (n.file.to) n.files = 0
      n.changed = n.file.status === 'same' || n.file.to ? 0 : 1
      n.added = n.file.added
      n.deleted = n.file.deleted
      n.lines = n.file.status === 'removed' ? 0 : (n.file.lines ?? 0)
      n.baseLines = n.file.status === 'added' ? 0 : (n.file.baseLines ?? n.file.lines ?? 0)
      n.bytes = n.file.status === 'removed' ? 0 : (n.file.bytes ?? 0)
      n.baseBytes = n.file.status === 'added' ? 0 : (n.file.baseBytes ?? n.file.bytes ?? 0)
      return
    }
    for (const c of n.children) {
      sum(c, depth + 1)
      n.files += c.files
      n.changed += c.changed
      n.added += c.added
      n.deleted += c.deleted
      n.lines += c.lines
      n.baseLines += c.baseLines
      n.bytes += c.bytes
      n.baseBytes += c.baseBytes
    }
    n.children.sort((a, b) => Number(!!a.file) - Number(!!b.file) || a.name.localeCompare(b.name))
  }
  sum(root, 0)
  return { root, byId }
}

/** A size on disk */
export const fmtBytes = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`)

export const fmt = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

/** Where views start: below any chain of lone folders */
export function startNode(root: TreeNode): TreeNode {
  let n = root
  while (n.children.length === 1 && !n.children[0].file) n = n.children[0]
  return n
}

/** Files imported from outside their own folder: the folder's exposed surface */
export function exposedFiles(g: Graph): Set<string> {
  const dir = (id: string) => id.slice(0, id.lastIndexOf('/'))
  const out = new Set<string>()
  for (const e of g.edges) if (e.status !== 'removed' && !e.source.startsWith(dir(e.target) + '/')) out.add(e.target)
  return out
}
