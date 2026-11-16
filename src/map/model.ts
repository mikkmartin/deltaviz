/** Graph shape shared by the server and the overlay (no node imports here). */

export type Status = 'same' | 'added' | 'modified' | 'removed'

export interface GraphNode {
  /** Repo-relative path */
  id: string
  cluster: string
  status: Status
  added: number
  deleted: number
  /** Lines of code now (before, for a removed file) */
  lines?: number
  /** Same, at the base commit; absent for an added file */
  baseLines?: number
  /** A package's share in a bundle (see Graph.packageBundle) */
  bundled?: { bytes: number; gzip: number; installed?: number }
  /** Size on disk now (before, for a removed file), and at the base */
  bytes?: number
  baseBytes?: number
  /** All lines now, blank ones too; changed files only */
  length?: number
  /** Moved (renamed) here from this path: an added node whose old one is removed */
  from?: string
  /** Moved from here to this path: the removed side of a move */
  to?: string
}

export interface GraphEdge {
  source: string
  target: string
  status: Exclude<Status, 'modified'>
}

/** A file's import of an npm package (or `node` for builtins), not a repo file */
export interface PackageEdge {
  source: string
  /** Package name: `react`, `@scope/name`, `node` */
  target: string
  status: Exclude<Status, 'modified'>
  /** How the importing file's package.json lists it: dependencies (peer, optional too), devDependencies, not at all; or a node builtin */
  kind: PackageKind
}
export type PackageKind = 'dep' | 'dev' | 'undeclared' | 'builtin'

export interface Graph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** Imports of packages outside the repo */
  packages?: PackageEdge[]
  /** Whether the branch changed a package.json's dependencies (peer, optional too) or devDependencies, versions included */
  declaredChanged?: Record<'dep' | 'dev', boolean>
  /** Each imported package's size on disk (its installed folder), where installed */
  packageBytes?: Record<string, number>
  /** What the code's imports of each package add to a bundle: just what it imports, tree-shaken and minified (its own deps included) */
  packageBundle?: Record<string, { bytes: number; gzip: number }>
  /** With the package.json section drawn, the root package.json: the section's header shows its changes (it isn't a cell of its own) */
  pkgJson?: GraphNode
}
