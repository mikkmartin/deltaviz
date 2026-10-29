// Builds the CLI (src/cli.ts → dist/cli.js, node) and the page (src/app.tsx → dist/app.js, browser).
// Everything is bundled in: the package has no runtime dependencies. esbuild stays
// external: the package-size prototype (map/read.ts) uses it only if it's installed.
import { build } from 'esbuild'

await Promise.all([
  build({
    entryPoints: ['src/cli.ts'],
    outfile: 'dist/cli.js',
    platform: 'node',
    format: 'esm',
    target: 'node24',
    bundle: true,
    external: ['esbuild'],
  }),
  build({
    entryPoints: ['src/app.tsx'],
    outfile: 'dist/app.js',
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    bundle: true,
    minify: true,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
  }),
])
