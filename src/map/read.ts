import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { branchBase } from '../base.js'
import { addedLines, readRegular } from '../files.js'
import type { Mode } from '../diff.js'
import { diffGraph, isGraphFile, isSource, parseNumstat, type Graph, type Numstat, type Snapshot } from './graph.js'

/**
 * The Map tab: the module graph of a checkout, diffed against where its branch left
 * the default branch (see base.ts) or from HEAD, uncommitted changes included.
 */

export interface GraphResponse extends Graph {
  /** Branch compared against, e.g. origin/main */
  baseRef: string | null
  baseSha: string | null
  branch: string | null
  /** Ncommitted files among the changes */
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

/** Contents of many blobs from one `git cat-file --batch`. */
function readBlobs(cwd: string, rev: string, files: string[]): Promise<Map<string, string>> {
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
      for (const file of files) {
        const nl = buf.indexOf(10, at)
        const header = buf.toString('utf8', at, nl)
        at = nl + 1
        if (header.endsWith(' missing')) continue
        const size = Number(header.split(' ')[2])
        if (size <= MAX_BYTES) out.set(file, buf.toString('utf8', at, at + size))
        at += size + 1
      }
      resolve(out)
    })
    proc.stdin.end(files.map((f) => `${rev}:${f}\n`).join(''))
  })
}

/** Package manifests resolve workspace imports; read them alongside the sources. */
const wanted = isGraphFile

/** `mode`: against the branch's merge-base, or only what's uncommitted (against HEAD). */
export async function readGraph(checkout: string, configuredBase?: unknown, mode: Mode = 'branch'): Promise<GraphResponse> {
  // Paths below are relative to the repo root, whichever folder the project is.
  const dir = (await git(checkout, ['rev-parse', '--show-toplevel']).catch(() => fail(404, 'not a git repository'))).trim()
  const [against, branch] = await Promise.all([
    mode === 'branch'
      ? branchBase(dir, configuredBase)
      : git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']).then((s) => ({ ref: 'HEAD', sha: s.trim() }), () => null),
    git(dir, ['symbolic-ref', '--short', '-q', 'HEAD']).then((s) => s.trim() || null, () => null),
  ])
  const sha = against?.sha ?? null

  // Head: tracked + untracked (not ignored) files as they are on disk.
  const headFiles = records(await git(dir, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).filter(
    (f) => wanted(f) && fs.existsSync(path.join(dir, f)),
  )
  if (headFiles.filter(isSource).length > MAX_FILES) fail(413, `more than ${MAX_FILES} source files`)
  const head: Snapshot = {
    files: headFiles,
    read: (f) => readRegular(path.join(dir, f), MAX_BYTES)?.toString('utf8') ?? '',
  }

  let base: Snapshot | null = null
  let numstat: Numstat = {}
  let dirty = 0
  if (sha) {
    const baseFiles = records(await git(dir, ['ls-tree', '-r', '-z', '--full-tree', '--name-only', sha])).filter(wanted)
    const blobs = await readBlobs(dir, sha, baseFiles)
    base = { files: baseFiles, read: (f) => blobs.get(f) ?? '' }
    const [diff, untracked, status] = await Promise.all([
      git(dir, ['diff', '--numstat', '-z', '-M', sha]),
      git(dir, ['ls-files', '-z', '--others', '--exclude-standard']),
      git(dir, ['status', '--porcelain', '-z', '--no-renames']),
    ])
    numstat = parseNumstat(diff)
    // Ntracked files aren't in git diff: count them as all added.
    for (const f of records(untracked).filter(isGraphFile)) {
      numstat[f] = { added: addedLines(head.read(f)), deleted: 0 }
    }
    dirty = records(status).filter((l) => isGraphFile(l.slice(3))).length
  }
  const graph = diffGraph(base, head, numstat)
  const packageBundle = await bundleSizes(dir, head, graph.packages ?? [])
  return { ...graph, packageBytes: packageBytes(dir, headFiles, graph.packages ?? []), packageBundle, baseRef: against?.ref ?? null, baseSha: sha, branch, dirty }
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

const bundleCache = new Map<string, { bytes: number; gzip: number } | null>()

/**
 * Per package, an entry exporting just what the code imports of it, bundled with
 * esbuild (minified, tree-shaken, its own dependencies in) from where its first importer is:
 * what those imports add to a bundle. For the browser, else (a node-only package) for node.
 */
async function bundleSizes(dir: string, head: Snapshot, edges: { source: string; target: string; status: string }[]) {
  const esbuild = await import('esbuild').catch(() => null)
  if (!esbuild) return {}
  const { gzipSync } = await import('node:zlib')
  const per = new Map<string, { from: Set<string>; specs: Map<string, Uses> }>()
  for (const e of edges) {
    if (e.status === 'removed' || e.target === 'node') continue
    const p = per.get(e.target) ?? { from: new Set<string>(), specs: new Map() }
    per.set(e.target, p)
    p.from.add(path.dirname(e.source))
    for (const [spec, u] of importsIn(head.read(e.source))) {
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
      if (!bundleCache.has(key)) {
        let size: { bytes: number; gzip: number } | null = null
        for (const platform of ['browser', 'node'] as const) {
          // Optional dependencies that aren't installed stay out (as they would at runtime).
          const external: string[] = []
          for (let attempt = 0; attempt < 3 && !size; attempt++) {
            try {
              const r = await esbuild.build({
                stdin: { contents, resolveDir, loader: 'ts' },
                bundle: true, minify: true, treeShaking: true, write: false, format: 'esm', platform, logLevel: 'silent', external,
                define: { 'process.env.NODE_ENV': '"production"' },
                loader: { '.css': 'empty', '.svg': 'empty', '.png': 'empty', '.woff': 'empty', '.woff2': 'empty', '.node': 'empty' },
              })
              const code = r.outputFiles[0].contents
              size = { bytes: code.length, gzip: gzipSync(code).length }
            } catch (e) {
              const missing = ((e as { errors?: { text: string }[] }).errors ?? []).map((x) => x.text.match(/^Could not resolve "([^"]+)"/)?.[1])
              if (platform === 'browser' || missing.some((m) => !m)) break
              external.push(...(missing as string[]))
            }
          }
          if (size) break
        }
        bundleCache.set(key, size)
      }
      const size = bundleCache.get(key)
      if (size) out[name] = size
    }),
  )
  return out
}

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
      walk(fs.realpathSync(at))
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
