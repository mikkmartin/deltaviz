/**
 * Module graph of a checkout and its diff against a base commit. Pure: the
 * server feeds it file lists and contents from git and the working tree.
 */
import path from 'node:path'
import type { Graph, GraphEdge, GraphNode, PackageKind, Status } from './model.js'

export type { Graph, GraphEdge, GraphNode, Status }

/** One side of the diff: source files and how to read them. */
export interface Snapshot {
  files: string[]
  read(file: string): string
}

export interface Numstat {
  /** `from`: the file's old path, when git saw it moved (renamed) */
  [file: string]: { added: number; deleted: number; from?: string }
}

const SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte|css|s[ac]ss|less)$/
const STYLE = /\.(?:css|s[ac]ss|less)$/
const SKIP_DIR = /(?:^|\/)(?:node_modules|dist|build|out|coverage|vendor|\.next|\.nuxt|\.svelte-kit)\//

export function isSource(file: string): boolean {
  return SOURCE.test(file) && !SKIP_DIR.test(file) && !/\.(?:d\.ts|min\.js)$/.test(file)
}

export const isPackageJson = (file: string) => (file === 'package.json' || file.endsWith('/package.json')) && !SKIP_DIR.test(file)

/** What the graph holds: source files, and the package.jsons beside them (no imports, but their changes show) */
export const isGraphFile = (file: string) => isSource(file) || isPackageJson(file)

/** Specifiers of static imports, re-exports, dynamic import(), require() and Sass @use/@forward. */
export function parseImports(src: string): string[] {
  const out = new Set<string>()
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"\n]+)['"]/g,
    /\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
    /@(?:use|forward)\s+['"]([^'"\n]+)['"]/g,
  ]
  for (const re of patterns) for (const m of src.matchAll(re)) out.add(m[1])
  return [...out]
}

interface Pkg {
  /** Repo-relative dir, '' for the root */
  dir: string
  name: string
  /** Subpath ('.', './types') → candidate targets as written in package.json, in condition order */
  exports: Record<string, string[]>
  main?: string
  /** PROTOTYPE: names it depends on, at runtime (dependencies, peer, optional) and for development */
  deps: Set<string>
  dev: Set<string>
  /** PROTOTYPE: the same, with their versions, to see whether a branch changed them */
  declared: Record<'dep' | 'dev', string>
}

/** Reads the fields we resolve with; null for an unreadable package.json. */
export function parsePackageJson(file: string, text: string): Pkg | null {
  try {
    const json = JSON.parse(text) as { name?: unknown; main?: unknown; exports?: unknown; dependencies?: object; peerDependencies?: object; optionalDependencies?: object; devDependencies?: object }
    const exports: Record<string, string[]> = {}
    // Every target under the conditions (types, import, default, …): the first may be a .d.ts we don't index.
    const targets = (v: unknown): string[] =>
      typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(targets) : []
    const ex = json.exports
    // Without subpath keys the object is the root's conditions: { "import": "./dist/x.js", "types": … }.
    const subpaths = ex && typeof ex === 'object' && !Array.isArray(ex) && Object.keys(ex).some((k) => k.startsWith('.'))
    if (subpaths) {
      for (const [k, v] of Object.entries(ex)) if (k.startsWith('.') && targets(v).length) exports[k] = targets(v)
    } else if (ex) {
      if (targets(ex).length) exports['.'] = targets(ex)
    }
    const dir = path.posix.dirname(file)
    const versions = (...ds: unknown[]) => JSON.stringify(ds.flatMap((d) => (d && typeof d === 'object' ? Object.entries(d) : [])).sort())
    return {
      dir: dir === '.' ? '' : dir,
      name: typeof json.name === 'string' ? json.name : '',
      exports,
      main: typeof json.main === 'string' ? json.main : undefined,
      deps: new Set([json.dependencies, json.peerDependencies, json.optionalDependencies].flatMap((d) => (d && typeof d === 'object' ? Object.keys(d) : []))),
      dev: new Set(json.devDependencies && typeof json.devDependencies === 'object' ? Object.keys(json.devDependencies) : []),
      declared: { dep: versions(json.dependencies, json.peerDependencies, json.optionalDependencies), dev: versions(json.devDependencies) },
    }
  } catch {
    return null
  }
}

const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']
const STYLE_EXTS = ['.scss', '.sass', '.css', '.less']

/** Resolves import specifiers to files of one snapshot. */
export function makeResolver(files: Set<string>, pkgs: Pkg[]) {
  const join = (...parts: string[]) => path.posix.normalize(path.posix.join(...parts)).replace(/^\.\//, '')
  const tryFile = (p: string): string | undefined => {
    if (p.startsWith('..')) return undefined
    const bare = p.replace(/\.[cm]?jsx?$/, '')
    const tries = [p, ...EXTS.map((e) => bare + e), ...EXTS.map((e) => `${p}/index${e}`)]
    return tries.find((t) => files.has(t))
  }
  /** Sass: extension optional, `_partial` files, `dir/_index` */
  const tryStyle = (p: string): string | undefined => {
    if (p.startsWith('..')) return undefined
    const partial = path.posix.join(path.posix.dirname(p), `_${path.posix.basename(p)}`)
    const tries = [p, ...[p, partial, `${p}/_index`, `${p}/index`].flatMap((b) => STYLE_EXTS.map((e) => b + e))]
    return tries.find((t) => files.has(t))
  }
  /** Built output usually mirrors src/: try the source first. */
  const fromBuilt = (dir: string, target: string) => {
    const t = join(dir, target)
    return tryFile(t.replace(/(^|\/)(?:dist|build|lib)\//, '$1src/')) ?? tryFile(t)
  }
  const byName = new Map(pkgs.filter((p) => p.name).map((p) => [p.name, p]))
  const owner = (file: string) =>
    pkgs.filter((p) => p.dir === '' || file.startsWith(p.dir + '/')).sort((a, b) => b.dir.length - a.dir.length)[0]

  return (from: string, spec: string): string | undefined => {
    // In stylesheets a bare `@import 'vars'` is relative too.
    if (STYLE.test(from) && !/^(?:[~@]|[\w-]+:)/.test(spec)) {
      const own = tryStyle(join(path.posix.dirname(from), spec))
      if (own || spec.startsWith('.')) return own
    }
    if (spec.startsWith('.')) return tryFile(join(path.posix.dirname(from), spec))
    // Common tsconfig aliases: @/x and ~/x → <package>/src/x
    const alias = spec.match(/^[@~]\/(.+)/)
    if (alias) {
      const dir = owner(from)?.dir ?? ''
      return tryFile(join(dir, 'src', alias[1])) ?? tryFile(join(dir, alias[1]))
    }
    const m = spec.match(/^((?:@[^/]+\/)?[^/]+)(?:\/(.+))?$/)
    const pkg = m && byName.get(m[1])
    if (!pkg) return undefined
    const sub = m[2] ? `./${m[2]}` : '.'
    for (const target of pkg.exports[sub] ?? []) {
      const file = fromBuilt(pkg.dir, target)
      if (file) return file
    }
    if (sub === '.') {
      return (pkg.main && fromBuilt(pkg.dir, pkg.main)) ?? tryFile(join(pkg.dir, 'src/index')) ?? tryFile(join(pkg.dir, 'index'))
    }
    return tryFile(join(pkg.dir, 'src', m[2]!)) ?? tryFile(join(pkg.dir, m[2]!))
  }
}

/** Non-blank lines */
export function countLines(src: string): number {
  let n = 0
  for (const line of src.split('\n')) if (line.trim()) n++
  return n
}

interface FileStats {
  lines: number
  bytes: number
  /** All lines, blank ones too: where a diff's line numbers fall */
  length: number
}

/** PROTOTYPE: the npm package a specifier the repo can't resolve names, if any */
function packageOf(from: string, spec: string, own: Set<string>): string | undefined {
  if (/^(?:\.|\/|[@~]\/)/.test(spec)) return undefined
  if (STYLE.test(from) && !spec.startsWith('~')) return undefined
  if (spec.startsWith('node:') || BUILTINS.has(spec.split('/')[0])) return 'node'
  if (/^[\w-]+:/.test(spec)) return undefined // virtual:, http:, data:
  const name = spec.replace(/^~/, '').match(/^((?:@[^/]+\/)?[^/]+)/)?.[1]
  return name && !own.has(name) ? name : undefined
}
const BUILTINS = new Set(['fs', 'path', 'os', 'url', 'http', 'https', 'net', 'child_process', 'crypto', 'stream', 'events', 'util', 'assert', 'zlib', 'buffer', 'readline', 'worker_threads', 'module', 'process', 'tty', 'dns', 'querystring', 'perf_hooks', 'timers', 'v8', 'vm'])

function edgesOf(snap: Snapshot): { files: Set<string>; edges: Set<string>; packages: Set<string>; kinds: Map<string, PackageKind>; stats: Map<string, FileStats>; declared: Record<'dep' | 'dev', string> } {
  const files = new Set(snap.files.filter(isGraphFile))
  const pkgs = snap.files
    .filter(isPackageJson)
    .map((f) => parsePackageJson(f, snap.read(f)))
    .filter((p): p is Pkg => !!p)
  const resolve = makeResolver(files, pkgs)
  const own = new Set(pkgs.map((p) => p.name).filter(Boolean))
  const packages = new Set<string>()
  const kinds = new Map<string, PackageKind>()
  // The package.jsons a file is under, nearest first: a dependency listed further up still counts (hoisted).
  const owners = (f: string) => pkgs.filter((p) => p.dir === '' || f.startsWith(p.dir + '/')).sort((a, b) => b.dir.length - a.dir.length)
  const kindOf = (f: string, name: string): PackageKind => {
    if (name === 'node') return 'builtin'
    const os = owners(f)
    return os.some((p) => p.deps.has(name)) ? 'dep' : os.some((p) => p.dev.has(name)) ? 'dev' : 'undeclared'
  }
  const edges = new Set<string>()
  const stats = new Map<string, FileStats>()
  for (const f of files) {
    const src = snap.read(f)
    stats.set(f, { lines: countLines(src), bytes: Buffer.byteLength(src), length: src ? src.replace(/\n$/, '').split('\n').length : 0 })
    if (!isSource(f)) continue
    for (const spec of parseImports(src)) {
      const t = resolve(f, spec)
      if (t && t !== f) edges.add(`${f}\n${t}`)
      const p = t ? undefined : packageOf(f, spec, own)
      if (p) {
        packages.add(`${f}\n${p}`)
        kinds.set(`${f}\n${p}`, kindOf(f, p))
      }
    }
  }
  // Every package.json's dependencies (and devDependencies), versions too, in one string each.
  const declared = (k: 'dep' | 'dev') => JSON.stringify(pkgs.map((p) => [p.dir, p.declared[k]]).sort())
  return { files, edges, packages, kinds, stats, declared: { dep: declared('dep'), dev: declared('dev') } }
}

/**
 * Cluster per package when there are several (monorepo), else per top-level
 * folder (under src/), so a single-package app still gets groups.
 */
export function clusterer(files: string[], pkgDirs: string[]): (file: string) => string {
  const owning = (f: string) => pkgDirs.filter((d) => d === '' || f.startsWith(d + '/')).sort((a, b) => b.length - a.length)[0] ?? ''
  const used = new Set(files.map(owning))
  if (used.size > 1) return (f) => owning(f) || '(root)'
  return (f) => {
    const parts = f.slice(owning(f) ? owning(f).length + 1 : 0).split('/')
    if (parts[0] === 'src' && parts.length > 2) return `src/${parts[1]}`
    return parts.length > 1 ? parts[0] : '(root)'
  }
}

export function diffGraph(base: Snapshot | null, head: Snapshot, numstat: Numstat): Graph {
  const B = edgesOf(head)
  const A = base ? edgesOf(base) : { files: new Set<string>(), edges: new Set<string>(), packages: new Set<string>(), kinds: new Map<string, PackageKind>(), stats: new Map<string, FileStats>(), declared: B.declared }
  const all = [...new Set([...A.files, ...B.files])].sort()
  const pkgDirs = [...new Set([...(base?.files ?? []), ...head.files])]
    .filter((f) => f === 'package.json' || f.endsWith('/package.json'))
    .map((f) => (f === 'package.json' ? '' : path.posix.dirname(f)))
  const cluster = clusterer(all, pkgDirs)
  // Moves: a file now that git paired with one gone since the base.
  const movedTo = new Map<string, string>()
  for (const [id, s] of Object.entries(numstat)) {
    if (s.from && B.files.has(id) && !A.files.has(id) && A.files.has(s.from) && !B.files.has(s.from)) movedTo.set(s.from, id)
  }
  const nodes = all.map((id): GraphNode => {
    const { from, ...stat } = numstat[id] ?? { added: 0, deleted: 0 }
    const status: Status = !A.files.has(id) ? 'added' : !B.files.has(id) ? 'removed' : numstat[id] ? 'modified' : 'same'
    const now = B.stats.get(id)
    const before = A.stats.get(id)
    // git can pair a file with one the graph doesn't hold (util.ts → util.ts.bak, a.txt → a.ts,
    // into vendor/): its counts are then only the edit's, under the new path. The graph sees
    // a new file and a deleted one: count them whole.
    if (status === 'added' && from && movedTo.get(from) !== id) stat.added = now?.length ?? stat.added
    if (status === 'removed' && !numstat[id] && !movedTo.has(id)) stat.deleted = before?.length ?? 0
    return {
      id,
      cluster: cluster(id),
      status,
      ...stat,
      lines: (now ?? before)?.lines ?? 0,
      ...(before && { baseLines: before.lines }),
      bytes: (now ?? before)?.bytes ?? 0,
      ...(before && { baseBytes: before.bytes }),
      // Only edited files need it: their changes are drawn where they are in the file.
      ...(now && status !== 'same' && { length: now.length }),
      ...(from && movedTo.get(from) === id && { from }),
      ...(movedTo.has(id) && { to: movedTo.get(id) }),
    }
  })
  // Imports follow a move: the base's edges under the moved files' new paths, so a moved file's
  // own unchanged imports read as unchanged, not dropped at the old path and added at the new.
  const moved = (f: string) => movedTo.get(f) ?? f
  const baseEdges = new Set([...A.edges].map((e) => e.split('\n').map(moved).join('\n')))
  const edges = [...new Set([...baseEdges, ...B.edges])].map((e): GraphEdge => {
    const [source, target] = e.split('\n')
    return { source, target, status: !baseEdges.has(e) ? 'added' : !B.edges.has(e) ? 'removed' : 'same' }
  })
  const basePkgs = new Set([...A.packages].map((e) => { const [f, p] = e.split('\n'); return `${moved(f)}\n${p}` }))
  const packages = [...new Set([...basePkgs, ...B.packages])].map((e) => {
    const [source, target] = e.split('\n')
    const status = !basePkgs.has(e) ? 'added' : !B.packages.has(e) ? 'removed' : 'same'
    const kind = B.kinds.get(e) ?? [...A.kinds].find(([k]) => { const [f, p] = k.split('\n'); return `${moved(f)}\n${p}` === e })?.[1] ?? 'undeclared'
    return { source, target, status, kind } as const
  })
  const declaredChanged = { dep: A.declared.dep !== B.declared.dep, dev: A.declared.dev !== B.declared.dev }
  return { nodes, edges, packages, declaredChanged }
}

/**
 * `git diff --numstat` output, `-z` or not; binary files ('-') count as 0. With
 * `-z -M`, a move is `added\tdeleted\t` then its old and new paths as records:
 * counted under the new path, with `from`.
 */
export function parseNumstat(text: string): Numstat {
  const out: Numstat = {}
  const records = text.split(/[\0\n]/)
  for (let i = 0; i < records.length; i++) {
    const [a, d, file] = records[i].split('\t')
    const stat = { added: Number(a) || 0, deleted: Number(d) || 0 }
    if (file) out[file] = stat
    else if (file === '' && records[i + 2]) {
      out[records[i + 2]] = { ...stat, from: records[i + 1] }
      i += 2
    }
  }
  return out
}
