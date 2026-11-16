import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { gzip } from 'node:zlib'
import { branchBase } from '../base.js'
import { readRegular } from '../files.js'
import type { Mode } from '../diff.js'
import { diffGraph, sideOf, isGraphFile, isSource, parseNumstat, scanFile, type FileScan, type Graph, type Numstat, type Side } from './graph.js'
import type { PackageEdge } from './model.js'

/**
 * The Map tab: the module graph of a checkout, diffed against where its branch left
 * the default branch (see base.ts) or from HEAD, uncommitted changes included.
 */

export interface GraphResponse extends Graph {
  /** Branch compared against, e.g. origin/main */
  baseRef: string | null
  baseSha: string | null
  branch: string | null
  /** Uncommitted files among the changes */
  dirty: number
}

const MAX_FILES = 10000
const MAX_BYTES = 512 * 1024

function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    // Paths unquoted (non-ASCII names as they are); listings below are NUL-separated as well.
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, timeout: 20_000, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout),
    ),
  )
}

/** Records of a `-z` listing */
const records = (s: string) => s.split('\0').filter(Boolean)

/** Contents of many blobs, by object id, from one `git cat-file --batch`; ones over MAX_BYTES (or missing) are left out. */
function readBlobs(cwd: string, oids: string[]): Promise<Map<string, string>> {
  if (!oids.length) return Promise.resolve(new Map())
  return new Promise((resolve, reject) => {
    const proc = spawn('git', ['cat-file', '--batch'], { cwd })
    const chunks: Buffer[] = []
    proc.stdout.on('data', (c: Buffer) => chunks.push(c))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`git cat-file exited with ${code}`))
      const buf = Buffer.concat(chunks)
      const out = new Map<string, string>()
      let at = 0
      for (const oid of oids) {
        const nl = buf.indexOf(10, at)
        const header = buf.toString('utf8', at, nl)
        at = nl + 1
        if (header.endsWith(' missing')) continue
        const size = Number(header.split(' ')[2])
        if (size <= MAX_BYTES) out.set(oid, buf.toString('utf8', at, at + size))
        at += size + 1
      }
      resolve(out)
    })
    proc.stdin.end(oids.map((o) => `${o}\n`).join(''))
  })
}

/** Package manifests resolve workspace imports; read them alongside the sources. */
const wanted = isGraphFile

/** A text's scan, kept by its git object id: the same text is scanned once, wherever it is (the working tree, a commit) */
interface Kept {
  scan: FileScan
  /** A package.json's (its dependencies are read from it); null for a source file */
  text: string | null
  /** What it imports of each specifier, once the package sizes asked */
  uses?: Map<string, Uses>
}
/**
 * What's kept between reads, so a re-read (every save, the other mode) scans only what changed.
 * Sources and package.jsons apart: a source's scan has imports, a package.json's doesn't, should two share a blob.
 */
const keptSources = new Map<string, Kept>()
const keptManifests = new Map<string, Kept>()
const keptOf = (file: string) => (isSource(file) ? keptSources : keptManifests)
/** A working-tree file's object id, while its stat is the same */
const keptFiles = new Map<string, { stamp: string; oid: string }>()
/** A commit's whole side */
const keptSides = new Map<string, Promise<Side>>()
/** Commits whose side is kept: the two modes' bases, and the ones before a commit or a rebase */
const MAX_SIDES = 4
const MAX_BLOBS = 200_000
/** Working-tree files read at a time */
const READS = 64
/**
 * A file changed this recently may change again within its timestamp's resolution (a second, on some
 * filesystems) at the same size: its stat says nothing, so it isn't kept (git's "racy" files).
 */
const RACY_MS = 2000

function keep(oid: string, file: string, text: string): Kept {
  const kept = keptOf(file)
  let k = kept.get(oid)
  if (!k) kept.set(oid, (k = { scan: scanFile(file, text), text: isSource(file) ? null : text }))
  return k
}

const NOFOLLOW = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0)

/**
 * A regular file's contents, or empty: as readRegular, but checked on the file as opened, so one
 * swapped since its lstat (for a link, a FIFO, a bigger file) isn't followed, waited on or read whole.
 */
async function readSafely(file: string): Promise<Buffer> {
  const none = Buffer.alloc(0)
  const handle = await fs.promises.open(file, NOFOLLOW).catch(() => null)
  if (!handle) return none
  try {
    const st = await handle.stat()
    return st.isFile() && st.size <= MAX_BYTES ? await handle.readFile() : none
  } catch {
    return none
  } finally {
    await handle.close()
  }
}

/**
 * The working tree's side: the listed files that are there. Only those whose stat changed are
 * read, and of those only a text not seen before is scanned (`hash`: the repo's, for git's ids).
 */
async function headSnapshot(dir: string, listed: string[], hash: string) {
  const files: string[] = []
  const kept = new Map<string, Kept>()
  const fresh: { file: string; stamp: string | null; regular: boolean }[] = []
  const racy = Date.now() - RACY_MS
  for (const file of listed) {
    const full = path.join(dir, file)
    let st: fs.Stats
    try {
      st = fs.lstatSync(full)
    } catch {
      continue // tracked, but gone from disk
    }
    // A link counts if it leads somewhere (it's never read: see readSafely).
    if (st.isSymbolicLink() && !fs.existsSync(full)) continue
    files.push(file)
    const stamp = `${st.mtimeMs} ${st.ctimeMs} ${st.size} ${st.ino}`
    const known = keptFiles.get(full)
    const k = known?.stamp === stamp ? keptOf(file).get(known.oid) : undefined
    if (k) kept.set(file, k)
    else fresh.push({ file, stamp: Math.max(st.mtimeMs, st.ctimeMs) < racy ? stamp : null, regular: st.isFile() && st.size <= MAX_BYTES })
  }
  if (files.filter(isSource).length > MAX_FILES) fail(413, `more than ${MAX_FILES} source files`)

  /** This read's texts, for their package imports; let go once the package sizes are read */
  const texts = new Map<string, string>()
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(READS, fresh.length) }, async () => {
      while (next < fresh.length) {
        const { file, stamp, regular } = fresh[next++]
        const full = path.join(dir, file)
        // Anything that isn't a regular file (or is gone meanwhile) reads as empty.
        const buf = regular ? await readSafely(full) : Buffer.alloc(0)
        const oid = createHash(hash).update(`blob ${buf.length}\0`).update(buf).digest('hex')
        const text = buf.toString('utf8')
        texts.set(file, text)
        kept.set(file, keep(oid, file, text))
        if (stamp) keptFiles.set(full, { stamp, oid })
        else keptFiles.delete(full)
      }
    }),
  )
  const onDisk = (f: string) => readRegular(path.join(dir, f), MAX_BYTES)?.toString('utf8') ?? ''
  return {
    files,
    read: (f: string) => kept.get(f)?.text ?? '',
    // Not among the listed (it appeared since): as it is now.
    scan: (f: string) => kept.get(f)?.scan ?? scanFile(f, onDisk(f)),
    /** What a file imports of each specifier */
    uses: (f: string) => {
      const k = kept.get(f)
      const text = texts.get(f)
      // Read in an earlier read (whose sizes weren't): as it is now, not kept (it may have changed since).
      if (!k || text === undefined) return k?.uses ?? importsIn(onDisk(f))
      return (k.uses ??= importsIn(text))
    },
    /** The texts aren't needed past the package sizes */
    done: () => texts.clear(),
  }
}
type Head = Awaited<ReturnType<typeof headSnapshot>>

/**
 * A commit's side: its tree listed, the blobs not seen before read (one cat-file), the rest from
 * their kept scans. After `head`: most of a commit's texts are the working tree's, kept by then.
 */
function baseSide(dir: string, sha: string, head: Promise<unknown>): Promise<Side> {
  const key = `${dir}\n${sha}`
  let side = keptSides.get(key)
  // Asked again: it's the newest (the oldest goes first).
  if (side) keptSides.delete(key)
  else {
    side = (async () => {
      const [listing] = await Promise.all([git(dir, ['ls-tree', '-r', '-z', '--full-tree', sha]), head])
      // `<mode> <type> <oid>\t<path>`
      const tree: [file: string, oid: string][] = []
      for (const r of records(listing)) {
        const tab = r.indexOf('\t')
        const file = r.slice(tab + 1)
        if (wanted(file)) tree.push([file, r.slice(0, tab).split(' ')[2]])
      }
      // Held here: what's kept may be dropped (another read, past MAX_BLOBS) while cat-file runs.
      const kept = new Map<string, Kept>()
      for (const [file, oid] of tree) {
        const k = keptOf(file).get(oid)
        if (k) kept.set(file, k)
      }
      const texts = await readBlobs(dir, [...new Set(tree.filter(([file]) => !kept.has(file)).map(([, oid]) => oid))])
      for (const [file, oid] of tree) {
        if (kept.has(file)) continue
        const text = texts.get(oid)
        // Missing (a partial clone) or too big: read as empty, but not kept under its id (its text isn't empty).
        kept.set(file, text === undefined ? { scan: scanFile(file, ''), text: isSource(file) ? null : '' } : keep(oid, file, text))
      }
      return sideOf({ files: tree.map(([file]) => file), read: (f) => kept.get(f)?.text ?? '', scan: (f) => kept.get(f)!.scan })
    })()
    // A failed read isn't kept.
    side.catch(() => keptSides.get(key) === side && keptSides.delete(key))
  }
  keptSides.set(key, side)
  if (keptSides.size > MAX_SIDES) keptSides.delete(keptSides.keys().next().value!)
  return side
}

/**
 * `mode`: against the branch's merge-base, or only what's uncommitted (against HEAD).
 * `sizes` reads the imported packages' sizes, apart: bundling them takes seconds, and the graph doesn't wait.
 */
export async function readGraph(checkout: string, configuredBase?: unknown, mode: Mode = 'branch'): Promise<{ graph: GraphResponse; sizes: () => Promise<PackageSizes> }> {
  // Paths below are relative to the repo root, whichever folder the project is.
  const dir = (await git(checkout, ['rev-parse', '--show-toplevel']).catch(() => fail(404, 'not a git repository'))).trim()
  // Snapshots hold their blobs: dropping the kept ones only costs the next read.
  if (keptSources.size + keptManifests.size > MAX_BLOBS) keptSources.clear(), keptManifests.clear(), keptFiles.clear()
  // All at once, each waiting only for what it needs: git lists and diffs while the working tree is read.
  const list = (...which: string[]) => git(dir, ['ls-files', '-z', ...which, '--exclude-standard']).then(records)
  const refs = Promise.all([
    mode === 'branch'
      ? branchBase(dir, configuredBase)
      : git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']).then((s) => ({ ref: 'HEAD', sha: s.trim() }), () => null),
    git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']).then((s) => s.trim() || null, () => null),
  ])
  // Head: tracked + untracked (not ignored) files as they are on disk.
  const objectFormat = git(dir, ['rev-parse', '--show-object-format']).then((s) => (s.trim() === 'sha256' ? 'sha256' : 'sha1'), () => 'sha1')
  const reading = Promise.all([list('--cached', '--others'), objectFormat]).then(([listed, hash]) => headSnapshot(dir, listed.filter(wanted), hash))
  /** The base's side and the diff against it; null without a base */
  const comparing = refs.then(([base]) => (base ? Promise.all([baseSide(dir, base.sha, reading), git(dir, ['diff', '--numstat', '-z', '-M', base.sha])]) : null))
  const [[base, branch], head, old, untracked, status] = await Promise.all([refs, reading, comparing, list('--others'), git(dir, ['status', '--porcelain', '-z', '--no-renames']).then(records)])
  const sha = base?.sha ?? null

  let numstat: Numstat = {}
  let dirty = 0
  if (old) {
    numstat = parseNumstat(old[1])
    // Untracked files aren't in git diff: count them as all added.
    for (const f of untracked.filter(isGraphFile)) numstat[f] = { added: head.scan(f).length, deleted: 0 }
    dirty = status.filter((l) => isGraphFile(l.slice(3))).length
  }
  const graph = diffGraph(old?.[0] ?? null, sideOf(head), numstat)
  let sizes: Promise<PackageSizes> | undefined
  return {
    graph: { ...graph, baseRef: base?.ref ?? null, baseSha: sha, branch, dirty },
    sizes: () => (sizes ??= packageSizes(dir, head, graph.packages ?? []).finally(head.done)),
  }
}

/** Each imported package's size, in a bundle and installed (see Graph.packageBundle, packageBytes) */
export type PackageSizes = Required<Pick<Graph, 'packageBundle' | 'packageBytes'>>

async function packageSizes(dir: string, head: Head, edges: PackageEdge[]): Promise<PackageSizes> {
  const packageBundle = await bundleSizes(dir, head, edges)
  return { packageBundle, packageBytes: packageBytes(dir, head.files, edges) }
}

/** What a file imports of each module specifier: names, the default, all of it (namespace, dynamic, require), or just its side effects */
interface Uses {
  names: Set<string>
  default: boolean
  all: boolean
}
function importsIn(src: string): Map<string, Uses> {
  const out = new Map<string, Uses>()
  const use = (spec: string) => out.get(spec) ?? (out.set(spec, { names: new Set(), default: false, all: false }), out.get(spec)!)
  for (const m of src.matchAll(/\b(import|export)\s+(type\s+)?([\w*{}\s,$]+?)\s+from\s+['"]([^'"\n]+)['"]/g)) {
    if (m[2]) continue
    const u = use(m[4])
    const clause = m[3]
    if (/\*/.test(clause)) u.all = true
    const braces = clause.match(/\{([^}]*)\}/)
    for (const part of braces?.[1].split(',') ?? []) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]
      if (name && !/^type\s/.test(part.trim())) name === 'default' ? (u.default = true) : u.names.add(name)
    }
    const head = clause.replace(/\{[^}]*\}/, '').replace(/\*\s*as\s+\w+/, '').replace(/,/g, '').trim()
    if (m[1] === 'import' && head) u.default = true
  }
  for (const m of src.matchAll(/\bimport\s+['"]([^'"\n]+)['"]/g)) use(m[1])
  for (const m of src.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)) use(m[1]).all = true
  return out
}

/** Each bundle measured once, also when asked again mid-way (a save during the first read) */
const bundleCache = new Map<string, Promise<{ bytes: number; gzip: number } | null>>()
const gzipped = promisify(gzip)

/**
 * Per package, an entry exporting just what the code imports of it, bundled with
 * esbuild (minified, tree-shaken, its own dependencies in) from where its first importer is:
 * what those imports add to a bundle. For the browser, else (a node-only package) for node.
 */
async function bundleSizes(dir: string, head: Head, edges: PackageEdge[]) {
  // esbuild gets a third of the cores (said before its service starts): a graph read meanwhile (a save, the other mode) stays quick.
  process.env.GOMAXPROCS ??= String(Math.max(1, Math.floor(os.availableParallelism() / 3)))
  const esbuild = await import('esbuild').catch(() => null)
  if (!esbuild) return {}
  const per = new Map<string, { from: Set<string>; specs: Map<string, Uses> }>()
  for (const e of edges) {
    if (e.status === 'removed' || e.target === 'node') continue
    const p = per.get(e.target) ?? { from: new Set<string>(), specs: new Map() }
    per.set(e.target, p)
    p.from.add(path.dirname(e.source))
    for (const [spec, u] of head.uses(e.source)) {
      const name = spec.replace(/^~/, '').match(/^((?:@[^/]+\/)?[^/]+)/)?.[1]
      if (name !== e.target) continue
      const all = p.specs.get(spec) ?? { names: new Set(), default: false, all: false }
      u.names.forEach((n) => all.names.add(n))
      all.default ||= u.default
      all.all ||= u.all
      p.specs.set(spec, all)
    }
  }
  const out: Record<string, { bytes: number; gzip: number }> = {}
  await Promise.all(
    [...per].map(async ([name, { from, specs }]) => {
      let i = 0
      const lines = [...specs].map(([spec, u]) => {
        const s = JSON.stringify(spec)
        if (u.all) return `export * as _${i++} from ${s}`
        const parts = [...u.names].map((n) => `${n} as _${i++}`)
        if (u.default) parts.push(`default as _${i++}`)
        return parts.length ? `export { ${parts.join(', ')} } from ${s}` : `import ${s}`
      })
      const contents = lines.join('\n')
      // From where an importer is that has it installed (a template folder may not).
      const resolveDir = [...from].map((d) => path.join(dir, d)).find((d) => {
        for (let at = d; at.startsWith(dir); at = path.dirname(at)) if (fs.existsSync(path.join(at, 'node_modules', name))) return true
        return false
      })
      if (!resolveDir) return
      const key = `${resolveDir}\n${contents}`
      let measured = bundleCache.get(key)
      if (!measured) {
        measured = (async () => {
          for (const platform of ['browser', 'node'] as const) {
            // Optional dependencies that aren't installed stay out (as they would at runtime).
            const external: string[] = []
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                const r = await esbuild.build({
                  stdin: { contents, resolveDir, loader: 'ts' },
                  bundle: true, minify: true, treeShaking: true, write: false, format: 'esm', platform, logLevel: 'silent', external,
                  define: { 'process.env.NODE_ENV': '"production"' },
                  loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff': 'empty', '.woff2': 'empty', '.node': 'empty' },
                })
                const code = r.outputFiles[0].contents
                // Off this thread: megabytes of bundle, per package.
                return { bytes: code.length, gzip: (await gzipped(code)).length }
              } catch (e) {
                const missing = ((e as { errors?: { text: string }[] }).errors ?? []).map((x) => x.text.match(/^Could not resolve "([^"]+)"/)?.[1])
                if (platform === 'browser' || missing.some((m) => !m)) break
                external.push(...(missing as string[]))
              }
            }
          }
          return null
        })()
        bundleCache.set(key, measured)
      }
      const size = await measured
      if (size) out[name] = size
    }),
  )
  return out
}

/** An installed folder's size, kept while its package.json is the same one (a reinstall writes it anew) */
const installed = new Map<string, { stamp: number; bytes: number }>()

/**
 * Each package's installed size: its folder under the nearest node_modules
 * (the repo's, or a workspace package's), followed through pnpm's link but not into its own deps.
 */
function packageBytes(dir: string, files: string[], edges: { target: string }[]): Record<string, number> {
  const roots = ['', ...files.filter((f) => f.endsWith('/package.json')).map((f) => path.posix.dirname(f))].map((d) => path.join(dir, d, 'node_modules'))
  const out: Record<string, number> = {}
  for (const name of new Set(edges.map((e) => e.target))) {
    if (name === 'node') continue
    const at = roots.map((r) => path.join(r, name)).find((p) => fs.existsSync(p))
    if (!at) continue
    let total = 0
    let budget = 50_000
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (--budget < 0) return
        if (e.name === 'node_modules') continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.isFile()) total += fs.statSync(p).size
      }
    }
    try {
      const real = fs.realpathSync(at)
      const stamp = fs.statSync(path.join(real, 'package.json'), { throwIfNoEntry: false })?.mtimeMs ?? 0
      const was = installed.get(real)
      if (was?.stamp === stamp) total = was.bytes
      else {
        walk(real)
        installed.set(real, { stamp, bytes: total })
      }
      out[name] = total
    } catch {}
  }
  return out
}

/**
 * A file's text as it is on disk, for the code view (and a changed file's whole-file
 * diff). `file` is repo-relative, like the graph's ids; only files inside the repo
 * that git doesn't ignore are read.
 */
export async function readSource(checkout: string, file: string): Promise<{ path: string; text: string }> {
  const dir = (await git(checkout, ['rev-parse', '--show-toplevel']).catch(() => fail(404, 'not a git repository'))).trim()
  const rel = path.posix.normalize(file)
  // Any `.git` on the way, in any case (macOS and Windows filesystems don't tell `.GIT` from `.git`).
  if (path.posix.isAbsolute(rel) || rel.startsWith('../') || rel.toLowerCase().split('/').includes('.git')) fail(400, `not a file in the repo: ${file}`)
  // Anything git would show: not what it ignores (.env, build output, node_modules).
  // Exit 1 is "not ignored"; 0 is ignored, and anything else (a path past a symlink) is refused too.
  const shown = await new Promise<boolean>((resolve) => execFile('git', ['check-ignore', '-q', '--', rel], { cwd: dir }, (err) => resolve(err?.code === 1)))
  if (!shown) fail(403, `ignored by git: ${file}`)
  const full = path.join(dir, rel)
  // A linked folder on the way could lead out of the repo.
  const real = (p: string) => fs.realpathSync(p)
  const inside = (() => {
    try {
      return real(full).startsWith(real(dir) + path.sep)
    } catch {
      return false
    }
  })()
  const buf = (inside && readRegular(full, MAX_BYTES)) || fail(404, `can't read ${file}`)
  return { path: rel, text: buf.toString('utf8') }
}
