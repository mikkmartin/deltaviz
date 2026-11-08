// Builds the CLI (src/cli.ts → dist/cli.js, node) and the page (src/app.tsx → dist/app.js, browser).
// Everything is bundled in: the package has no runtime dependencies. esbuild stays
// external: the package-size prototype (map/read.ts) uses it only if it's installed.
//
// `node build.ts --watch [cli args]`: rebuilds on every save and runs the CLI in dev
// mode (DELTAVIZ_DEV=1), restarting it when it's rebuilt; open pages reload themselves
// when the page or the server is rebuilt.
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import { build, context, type BuildOptions, type Plugin } from 'esbuild'

const cli: BuildOptions = {
  entryPoints: ['src/cli.ts'],
  outfile: 'dist/cli.js',
  platform: 'node',
  format: 'esm',
  target: 'node24',
  bundle: true,
  external: ['esbuild'],
}
const app: BuildOptions = {
  entryPoints: ['src/app.tsx'],
  outfile: 'dist/app.js',
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  bundle: true,
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
}

// The page's font (and its licence, which ships with it), served as they are.
fs.mkdirSync('dist', { recursive: true })
for (const f of ['GeistMono-Variable.woff2', 'GeistMono-LICENSE.txt']) fs.copyFileSync(`assets/${f}`, `dist/${f}`)

const at = process.argv.indexOf('--watch')
if (at < 0) await Promise.all([build(cli), build(app)])
else {
  const args = process.argv.slice(at + 1)
  let server: ChildProcess | undefined
  let opened = false
  const start = () => {
    server = spawn(process.execPath, ['dist/cli.js', ...args, ...(opened ? ['--no-open'] : [])], { stdio: 'inherit', env: { ...process.env, DELTAVIZ_DEV: '1' } })
    opened = true
  }
  /** A restart waiting on the old server's exit: builds meanwhile join it (one new server, not one each) */
  let restarting = false
  // (Re)start the server after each good CLI build, once the old one has let go of its port.
  const restart: Plugin = {
    name: 'restart',
    setup: (b) =>
      b.onEnd((r) => {
        if (r.errors.length || restarting) return
        // Gone already: exited, or killed by a signal (no exit code then).
        if (!server || server.exitCode !== null || server.signalCode !== null) return start()
        restarting = true
        server.once('exit', () => ((restarting = false), start()))
        server.kill()
      }),
  }
  // The app first: the server mustn't serve a missing page.
  const appCtx = await context(app)
  await appCtx.rebuild()
  await appCtx.watch()
  await (await context({ ...cli, plugins: [restart] })).watch()
  const stop = () => (server?.kill(), process.exit(0))
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}
