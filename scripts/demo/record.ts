// Records the ~13s deltaviz demo: a throwaway worktree of origin/main, deltaviz on it, a
// scripted "agent" landing edits, then hover → imports, click a folder → zoom, click a file →
// diff. Captured with a CDP screencast at 2x, encoded with ffmpeg to an H.264 mp4 (social) and
// a GIF beside it (the README: npm and GitHub both show it).
//
//   pnpm build && pnpm --dir scripts/demo install && node scripts/demo/record.ts [out.mp4]
// Needs: Google Chrome, ffmpeg.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Page } from 'playwright-core'
import { apply, STEPS } from './agent.ts'

const REPO = path.resolve(import.meta.dirname, '../..')
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, '.context/deltaviz-demo.mp4'))
const W = 1440
const H = 810
const PORT = 4977
const BRANCH = 'search-box'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deltaviz-demo-'))
// Named like the repo, so the page's title reads "deltaviz".
const wt = path.join(tmp, 'deltaviz')
const frames = path.join(tmp, 'frames')
fs.mkdirSync(frames)
const git = (...a: string[]) => execFileSync('git', a, { cwd: REPO, stdio: 'pipe' }).toString().trim()

// A run killed before its cleanup leaves the worktree and branch behind: clear them first.
git('worktree', 'prune')
try {
  git('branch', '-D', BRANCH)
} catch {}
git('worktree', 'add', '-q', '-b', BRANCH, wt, 'origin/main')
const server = spawn(process.execPath, [path.join(REPO, 'dist/cli.js'), wt, '--no-open', '--port', String(PORT)], { stdio: 'ignore' })
const cleanup = () => {
  server.kill()
  try {
    git('worktree', 'remove', '--force', wt)
    git('branch', '-D', BRANCH)
  } catch {}
  fs.rmSync(tmp, { recursive: true, force: true })
}
process.on('exit', cleanup)
process.on('SIGINT', () => process.exit(130))

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break
  } catch {}
  if (i > 50) throw new Error('deltaviz did not start')
  await sleep(100)
}

// The cursor and the caption chip, drawn into the page so the screencast has them.
const OVERLAY = `
(() => {
  const css = document.createElement('style')
  css.textContent = \`
  #demo-cursor { position: fixed; z-index: 99999; left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%;
    background: rgba(255,255,255,.9); box-shadow: 0 0 0 2px rgba(0,0,0,.55), 0 2px 10px rgba(0,0,0,.5); pointer-events: none; transition: transform 120ms; opacity: 0; }
  #demo-cursor.down { transform: scale(.7); }
  #demo-ring { position: fixed; z-index: 99998; width: 22px; height: 22px; margin: -11px 0 0 -11px; border-radius: 50%; border: 2px solid #fff; pointer-events: none; opacity: 0; }
  #demo-ring.go { animation: demo-ring 500ms ease-out; }
  @keyframes demo-ring { from { opacity: .9; transform: scale(1) } to { opacity: 0; transform: scale(3.2) } }
  #demo-chip { position: fixed; z-index: 99999; left: 20px; bottom: 28px; transform: translateY(12px); padding: 12px 22px; border-radius: 999px;
    font: 500 26px/1.2 'Geist Mono', ui-monospace, monospace; letter-spacing: -0.02em; color: #fff; background: rgba(20,20,22,.92);
    border: 1px solid rgba(255,255,255,.14); box-shadow: 0 8px 30px rgba(0,0,0,.5); opacity: 0; transition: opacity 220ms, transform 220ms; pointer-events: none; white-space: nowrap; }
  #demo-chip.on { opacity: 1; transform: none; }
  #demo-chip b { color: #4ade80; font-weight: 500; }\`
  document.head.append(css)
  for (const id of ['demo-cursor', 'demo-ring', 'demo-chip']) { const d = document.createElement('div'); d.id = id; document.body.append(d) }
  const c = document.getElementById('demo-cursor'), r = document.getElementById('demo-ring')
  addEventListener('mousemove', (e) => { c.style.opacity = 1; c.style.left = r.style.left = e.clientX + 'px'; c.style.top = r.style.top = e.clientY + 'px' }, true)
  addEventListener('mousedown', () => { c.classList.add('down'); r.classList.remove('go'); void r.offsetWidth; r.classList.add('go') }, true)
  addEventListener('mouseup', () => c.classList.remove('down'), true)
})()
`

async function caption(page: Page, html: string | null) {
  await page.evaluate(async (html) => {
    const chip = document.getElementById('demo-chip')!
    if (chip.classList.contains('on')) {
      chip.classList.remove('on')
      await new Promise((r) => setTimeout(r, 230))
    }
    if (html) chip.innerHTML = html
    if (html) chip.classList.add('on')
  }, html)
}

/** A click, held long enough for the cursor's ring to show */
async function click(page: Page) {
  await sleep(200)
  await page.mouse.down()
  await sleep(90)
  await page.mouse.up()
}

/** The centre of a cell, a little up-left so the cursor sits on it, not on its edge */
async function cell(page: Page, id: string) {
  const box = (await page.locator(`[data-id="${id}"]`).first().boundingBox())!
  return { x: box.x + box.width * 0.5, y: box.y + Math.min(box.height * 0.5, 160) }
}

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
await page.goto(`http://127.0.0.1:${PORT}/`)
await page.locator('[data-id="src/app.tsx"]').waitFor()
await page.evaluate(OVERLAY)
// Parked on the sidebar's empty middle, off the map, while the edits land.
await page.mouse.move(170, 620)
await sleep(800)

// Every frame Chrome paints, with when it painted it.
const cdp = await page.context().newCDPSession(page)
const shots: { file: string; t: number }[] = []
cdp.on('Page.screencastFrame', async (f) => {
  const file = path.join(frames, `${String(shots.length).padStart(5, '0')}.jpg`)
  shots.push({ file, t: f.metadata.timestamp! })
  fs.writeFileSync(file, Buffer.from(f.data, 'base64'))
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
})
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 })

// 1. The agent edits; each save flashes its file and colours it in.
await sleep(500)
await caption(page, 'an agent is editing… <b>every save lights up</b>')
await sleep(300)
for (const s of STEPS) {
  apply(wt, s)
  await sleep(300)
}
await sleep(600)

// 2. Hover the new file: what imports it.
await caption(page, 'hover → <b>its new imports</b>')
await page.mouse.move(...Object.values(await cell(page, 'src/search.ts')) as [number, number], { steps: 40 })
await sleep(1500)

// 3. Click a folder's name: zoom in; its crumb in the bar: back out.
await caption(page, 'click a folder → <b>zoom in</b>')
const map = (await page.locator('[data-id="src/map"]').first().boundingBox())!
await page.mouse.move(map.x + map.width * 0.3, map.y + 8, { steps: 30 })
await click(page)
await sleep(1300)
const root = (await page.locator('.arch-seg button').first().boundingBox())!
await page.mouse.move(root.x + root.width / 2, root.y + root.height / 2, { steps: 30 })
await click(page)
await sleep(1100)

// 4. Click the most-changed file: its diff.
await caption(page, 'click a file → <b>its diff</b>')
await page.mouse.move(...Object.values(await cell(page, 'src/app.tsx')) as [number, number], { steps: 40 })
await click(page)
await sleep(1000)
// Down to the hunk that replaced a line.
for (let i = 0; i < 18; i++) {
  await page.mouse.wheel(0, 90)
  await sleep(33)
}
await sleep(1400)

await cdp.send('Page.stopScreencast')
const end = Date.now() / 1000
await browser.close()

// Frames come only when something changed: each lasts until the next one.
const list = shots.map((s, i) => `file '${s.file}'\nduration ${((shots[i + 1]?.t ?? end) - s.t).toFixed(4)}`).join('\n') + `\nfile '${shots.at(-1)!.file}'\n`
fs.writeFileSync(path.join(tmp, 'frames.txt'), list)
fs.mkdirSync(path.dirname(OUT), { recursive: true })
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'frames.txt'),
  '-vf', `scale=${W}:${H}:flags=lanczos,fps=60,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-movflags', '+faststart', OUT], { stdio: 'inherit' })
// The GIF: one palette for the whole clip, no dithering (flat dark UI: crisp text, no noise).
const gif = OUT.replace(/\.mp4$/, '') + '.gif'
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', OUT, '-vf',
  'fps=15,scale=1080:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', gif], { stdio: 'inherit' })
console.log(`${OUT} + ${gif} (${shots.length} frames, ${(end - shots[0].t).toFixed(1)}s)`)
process.exit(0)
