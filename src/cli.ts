#!/usr/bin/env node
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { changes } from './changes.js'
import type { Mode } from './diff.js'
import { readGraph, readSource } from './map/read.js'
import { watch } from './watch.js'

/**
 * `deltaviz [dir]`: serves the Tree of the git repo around `dir` on 127.0.0.1
 * (4848, or the next free port), opens it in the browser and pushes a change
 * event whenever the worktree or its git state changes. A second run in the
 * same repo just opens the running one.
 */

const HELP = `Usage: deltaviz [dir] [options]

Shows the git repo around dir (default: .) as a live treemap in the browser.

Options:
  --port <n>     First port to try (default 4848; the next free one is used)
  --base <ref>   Branch to compare against (default: origin's default branch)
  --no-open      Don't open the browser
  -h, --help     Show this help
  -v, --version  Show the version
`

const DIST = path.dirname(new URL(import.meta.url).pathname)
const VERSION: string = JSON.parse(fs.readFileSync(path.join(DIST, '../package.json'), 'utf8')).version
const PORT_TRIES = 20
/** Run by `npm run dev`: pages reload when the app is rebuilt or the server restarts */
const DEV = process.env.DELTAVIZ_DEV === '1'

// Our own git reads mustn't write the index (a refresh would wake the watcher).
process.env.GIT_OPTIONAL_LOCKS = '0'

function args(argv: string[]) {
  const out = { dir: '.', port: 4848, base: undefined as string | undefined, open: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-h' || a === '--help') (process.stdout.write(HELP), process.exit(0))
    else if (a === '-v' || a === '--version') (console.log(VERSION), process.exit(0))
    else if (a === '--no-open') out.open = false
    else if (a === '--port') out.port = Number(argv[++i])
    else if (a === '--base') out.base = argv[++i]
    else if (a.startsWith('-')) die(`unknown option ${a}\n\n${HELP}`)
    else out.dir = a
  }
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) die('--port needs a number between 1 and 65535')
  return out
}

function die(message: string): never {
  process.stderr.write(`deltaviz: ${message}\n`)
  process.exit(1)
}

const git = (cwd: string, a: string[]) =>
  new Promise<string>((resolve, reject) => execFile('git', a, { cwd }, (err, stdout, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(stdout.trim()))))

function open(url: string) {
  const [cmd, a] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  execFile(cmd, a, (err) => err && console.log(`Open ${url} in your browser`))
}

/** Whoever holds `port`, if it's a deltaviz: the repo it shows */
async function probe(port: number): Promise<string | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) })
    const body = (await r.json()) as { app?: string; root?: string }
    return body.app === 'deltaviz' ? (body.root ?? null) : null
  } catch {
    return null
  }
}

const opts = args(process.argv.slice(2))
const cwd = path.resolve(opts.dir)
if (!fs.existsSync(cwd)) die(`no such folder: ${cwd}`)
const root = await git(cwd, ['rev-parse', '--show-toplevel']).catch(() => die(`not inside a git repository: ${cwd}`))
const [prefix, common, own] = await Promise.all([git(cwd, ['rev-parse', '--show-prefix']), git(root, ['rev-parse', '--git-common-dir']), git(root, ['rev-parse', '--git-dir'])])
/** Where it was run, relative to the repo: the folder the Tree opens zoomed into */
const start = prefix.replace(/\/$/, '')
const commonDir = path.resolve(root, common)
/**
 * The project: the main checkout's folder, also from a linked worktree. Only when the shared
 * git dir is a checkout's `.git`: a submodule's (`.git/modules/x`) or a moved one says nothing, so its own folder.
 */
const name = path.basename(commonDir) === '.git' ? path.basename(path.dirname(commonDir)) : path.basename(root)
/** A linked worktree's folder, else null */
const worktree = path.resolve(root, own) === commonDir ? null : path.basename(root)

/**
 * Each mode's last read, as sent; dropped when something changes. `sizes` (the packages') comes
 * after the graph, on its own: it takes seconds, and the page shows the graph meanwhile.
 */
type Reads = { graph: Promise<string>; diff: Promise<string>; sizes: Promise<string> }
const cache = new Map<Mode, Reads>()
const read = (mode: Mode): Reads => {
  let r = cache.get(mode)
  if (!r) {
    const read = readGraph(root, opts.base, mode)
    r = {
      graph: read.then((g) => JSON.stringify(g.graph)),
      diff: changes(root, mode, opts.base).then((s) => JSON.stringify(s)),
      // Started with the graph: the page asks for them right after.
      sizes: read.then((g) => g.sizes()).then((s) => JSON.stringify(s)),
    }
    cache.set(mode, r)
    // A failed read isn't kept: the next request tries again. (Sizes fail only with the graph.)
    Promise.all([r.graph, r.diff]).catch(() => cache.get(mode) === r && cache.delete(mode))
    // Nobody may ask for them: a failure isn't unhandled.
    r.sizes.catch(() => {})
  }
  return r
}

const clients = new Set<http.ServerResponse>()
const settled = (p: Promise<string>) => p.catch((e: Error) => `!${e.message}`)

const broadcast = (msg: string) => {
  for (const c of clients) c.write(msg)
}

/**
 * Re-reads what the pages show, then tells them which files were touched (to flash)
 * and whether any of what they show changed (to re-read). Not the packages' sizes: they
 * come seconds later, and change only with what's imported, which changes the diff too.
 */
async function changed(paths: string[]) {
  const before = new Map([...cache].map(([m, r]) => [m, Promise.all([settled(r.graph), settled(r.diff)])]))
  cache.clear()
  let differs = before.size === 0
  for (const [mode, old] of before) {
    const r = read(mode)
    const [a, b] = await old
    if (a !== (await settled(r.graph)) || b !== (await settled(r.diff))) differs = true
  }
  if (!differs && !paths.length) return
  broadcast(`data: ${JSON.stringify({ changed: differs, paths })}\n\n`)
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>${name.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)} · deltaviz</title>
</head>
<body>
<div id="root"></div>
<script>window.DELTAVIZ = ${JSON.stringify({ name, worktree, root, start, dev: DEV }).replace(/</g, '\\u003c')}</script>
<script type="module" src="/app.js"></script>
</body>
</html>`

function send(res: http.ServerResponse, status: number, type: string, body: string | Buffer) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

const json = (res: http.ServerResponse, p: Promise<string>) =>
  p.then(
    (body) => send(res, 200, 'application/json', body),
    (e: Error & { status?: number }) => send(res, e.status ?? 500, 'application/json', JSON.stringify({ error: e.message })),
  )

/** Only pages from this server: a page elsewhere that rebinds its name to 127.0.0.1 (DNS rebinding) is refused. */
const ownHost = (host: string | undefined) => !!host && /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(host)

const server = http.createServer((req, res) => {
  if (!ownHost(req.headers.host)) return send(res, 403, 'text/plain', 'forbidden')
  const url = new URL(req.url ?? '/', 'http://x')
  const mode: Mode = url.searchParams.get('mode') === 'uncommitted' ? 'uncommitted' : 'branch'
  switch (url.pathname) {
    case '/':
      return send(res, 200, 'text/html; charset=utf-8', html)
    case '/app.js':
      // Mid-rebuild (dev) it can be missing for a moment: an error the page retries on, not a crash.
      try {
        return send(res, 200, 'text/javascript', fs.readFileSync(path.join(DIST, 'app.js')))
      } catch (e) {
        return send(res, 503, 'text/plain', `deltaviz: can't read the page: ${(e as Error).message}`)
      }
    case '/GeistMono-Variable.woff2': {
      // Missing (a build without assets/): the page falls back to the system's monospace, the server stays up.
      let font: Buffer
      try {
        font = fs.readFileSync(path.join(DIST, 'GeistMono-Variable.woff2'))
      } catch {
        return send(res, 404, 'text/plain', 'not found')
      }
      res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=31536000, immutable' })
      return void res.end(font)
    }
    case '/health':
      return send(res, 200, 'application/json', JSON.stringify({ app: 'deltaviz', version: VERSION, root }))
    case '/graph':
      return json(res, read(mode).graph)
    case '/diff':
      return json(res, read(mode).diff)
    case '/sizes':
      return json(res, read(mode).sizes)
    case '/file':
      return json(res, readSource(root, url.searchParams.get('path') ?? '').then((f) => JSON.stringify(f)))
    case '/events':
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(': hi\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    default:
      send(res, 404, 'text/plain', 'not found')
  }
})

/** Listens on the first free port from `opts.port`; a deltaviz of this repo already there just opens. */
async function listen(): Promise<number> {
  for (let port = opts.port; port < opts.port + PORT_TRIES; port++) {
    const ok = await new Promise<boolean>((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' ? resolve(false) : reject(e))
      server.once('error', onError)
      server.listen(port, '127.0.0.1', () => (server.off('error', onError), resolve(true)))
    })
    if (ok) return port
    if ((await probe(port)) === root) {
      const url = `http://127.0.0.1:${port}/`
      console.log(`deltaviz is already showing ${root} at ${url}`)
      if (opts.open) open(url)
      process.exit(0)
    }
  }
  die(`no free port in ${opts.port}–${opts.port + PORT_TRIES - 1}`)
}

// Dev: a rebuilt page reloads the open ones.
if (DEV) {
  let t: NodeJS.Timeout | undefined
  fs.watch(DIST, (_, f) => {
    if (f !== 'app.js') return
    clearTimeout(t)
    t = setTimeout(() => {
      broadcast('event: reload\ndata:\n\n')
    }, 100)
  })
}

const port = await listen()
const url = `http://127.0.0.1:${port}/`
await watch(root, changed)
console.log(`deltaviz: ${root} at ${url} (Ctrl-C to stop)`)
if (opts.open) open(url)
// Read the default view while the browser opens.
read('branch')

const stop = () => {
  for (const c of clients) c.end()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
