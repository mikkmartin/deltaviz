import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Mode, State } from './diff.js'
import { useKept } from './kept.js'
import { DiffModal } from './map/DiffModal.js'
import { MapView } from './map/MapView.js'
import { isPkgCell, withPackageFolder } from './map/packages.js'
import type { GraphResponse } from './map/read.js'
import { Summary, SUMMARY_CSS } from './map/Summary.js'
import { SHEET_CSS } from './sheet.js'
import { SWITCH_CSS } from './switch.js'
import { Tabs, TABS_CSS } from './tabs.js'
import { Sidebar, SIDEBAR_CSS, SidebarToggle, useSidebar } from './sidebar.js'
import { T } from './map/theme.js'
import { buildTree } from './map/tree.js'
import { useSize } from './map/useSize.js'
import { ACCENT, gray, MONO, red, white } from './palette.js'

/**
 * The page: the repo's Tree, full window, with the Summary beside it. Re-reads
 * when the server says something changed (/events); the Tree keeps its zoom.
 */

declare global {
  interface Window {
    DELTAVIZ: { name: string; worktree: string | null; root: string; start: string; dev: boolean }
  }
}
const { name, worktree, root, start, dev } = window.DELTAVIZ

const CSS = `
* { box-sizing: border-box; }
/* No bold anywhere: emphasis is colour and size. */
b, strong, h1, h2, h3, h4, h5, h6, th { font-weight: inherit; }
html, body, #root { margin: 0; height: 100%; background: ${T.canvas}; }
@font-face { font-family: 'Geist Mono'; src: url('/GeistMono-Variable.woff2') format('woff2'); font-weight: 100 900; font-display: block; }
body { font: 13px/1.4 ${MONO}; word-spacing: -0.25em; color: ${gray[200]}; color-scheme: dark; }
/* Padded at the sides only: the sidebar scrolls the window's full height (its padding inside), the main column pads itself. */
/* 8px on the left: the sidebar pads itself the rest (its rows' highlights reach into that); closed, the main column takes it back. */
.arch { display: flex; height: 100vh; padding: 0 14px 0 8px; }
.arch.sb-closed .arch-main { padding-left: 6px; }
.arch-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 8px; padding: 10px 0; }
/* Always one row: short of room, the stats and then the path's outer folders give way (cut short with …), never the controls. */
.arch-bar { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; white-space: nowrap; min-width: 0; font-size: 12px; }
.arch-bar > * { flex: none; }
.arch-bar > .lm-muted { flex: 0 1000 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.arch-bar b { color: ${gray[200]}; }
.arch-bar > .arch-grow { flex: 1 1 0; min-width: 0; }
.arch-seg { display: inline-flex; border: 1px solid ${gray[700]}; border-radius: 6px; overflow: hidden; }
.arch-bar > .arch-seg { flex: 0 1 auto; min-width: 0; }
.arch-seg button { all: unset; cursor: pointer; padding: 3px 12px; font-size: 12px; color: ${gray[400]}; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.arch-seg button.on { flex: none; background: ${gray[700]}; color: ${gray[200]}; }
.arch-map { flex: 1; min-height: 200px; display: flex; flex-direction: column; gap: 10px; overflow: hidden; }
.arch-map svg { display: block; }
.lm-icon-btn { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; color: ${gray[400]}; flex: none; }
.lm-icon-btn:hover { background: ${gray[800]}; color: ${white}; }
.lm-muted { color: ${gray[400]}; }
.lm-empty { color: ${gray[400]}; padding: 8px 0; }
.lm-error { color: ${red[500]}; padding: 4px 0; }
a { color: ${ACCENT}; text-decoration: none; }
@keyframes dv-flash { from { opacity: 0.9; } to { opacity: 0; } }
`

/** What a save did to a file: lines added (or a new file), removed (or the file deleted), or neither (edited in place, or not in the graph) */
type Saved = '+' | '-' | '='
type Flash = { paths: string[]; kinds: Record<string, Saved>; n: number }

/** Each touched file's `Saved`, from its lines before and after the re-read (blank ones too, when both reads counted them) */
function saved(paths: string[], before: GraphResponse | undefined, after: GraphResponse | undefined): Record<string, Saved> {
  const at = (g: GraphResponse | undefined) => new Map(g?.nodes.filter((n) => n.status !== 'removed').map((n) => [n.id, n]))
  const [a, b] = [at(before), at(after)]
  return Object.fromEntries(
    paths.map((p) => {
      const was = a.get(p)
      const now = b.get(p)
      if (!was || !now) return [p, !was && now ? '+' : was && !now && before ? '-' : '=']
      const d = was.length !== undefined && now.length !== undefined ? now.length - was.length : (now.lines ?? 0) - (was.lines ?? 0)
      return [p, d > 0 ? '+' : d < 0 ? '-' : '=']
    }),
  )
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url)
  const body = await r.json()
  if (!r.ok) throw new Error(body.error ?? r.statusText)
  return body as T
}

function App() {
  const [mode, setMode] = useKept<Mode>('mode', 'branch', true)
  const [data, setData] = useState<GraphResponse>()
  const [diff, setDiff] = useState<State>()
  const [error, setError] = useState('')
  const [mapRef, canvas] = useSize()
  const sidebar = useSidebar()
  /** File or folder under the pointer in the Summary or Tree; each lights it */
  const [hover, setHover] = useState<string | null>(null)
  /** File open over the view: a changed one's diff, else its code */
  const [opened, setOpened] = useState<string | null>(null)
  const close = useCallback(() => setOpened(null), [])
  /** Files' text as read, till something changes on disk: a hovered file is read ahead, so opening it is instant */
  const texts = useRef(new Map<string, Promise<{ text: string }>>())
  const read = useCallback((path: string) => {
    let p = texts.current.get(path)
    if (!p) {
      p = get<{ text: string }>(`/file?path=${encodeURIComponent(path)}`)
      texts.current.set(path, p)
      // A failed read isn't kept: opening it tries again.
      p.catch(() => texts.current.get(path) === p && texts.current.delete(path))
    }
    return p
  }, [])
  /** The graph's files, for a hover's quick lookup */
  const fileIds = useMemo(() => new Set(data?.nodes.map((n) => n.id)), [data])
  // Read ahead what's under the pointer, if it's a file the treemap holds.
  useEffect(() => {
    if (hover && fileIds.has(hover)) read(hover).catch(() => {})
  }, [hover, fileIds, read])
  /** Only the latest read may land */
  const latest = useRef(0)
  /** The graph as last read, for what a save did to a file's lines */
  const shown = useRef<GraphResponse>(undefined)
  /** Files just touched on disk, flashed by what the save did to their lines; `n` restarts the flash */
  const [flash, setFlash] = useState<Flash>()
  // Gone once faded: cells mounted later (a zoom) mustn't replay it.
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => setFlash((f) => (f === flash ? undefined : f)), 1000)
    return () => clearTimeout(t)
  }, [flash])

  /**
   * The graph and its diff, read together and shown together: the treemap relays out once, with its change lines (no in-between frame).
   * Resolves once they've landed (or failed): true, or false when a later read took over.
   */
  const load = useCallback(() => {
    const id = ++latest.current
    return Promise.allSettled([get<GraphResponse>(`/graph?mode=${mode}`), get<State>(`/diff?mode=${mode}`)]).then(([g, d]) => {
      if (id !== latest.current) return false
      if (g.status === 'fulfilled') {
        shown.current = g.value
        setData(g.value)
        setError('')
      } else setError((g.reason as Error).message)
      setDiff(d.status === 'fulfilled' ? d.value : { ok: false, error: (d.reason as Error).message })
      return true
    })
  }, [mode])
  // Another mode (or the first read): what's shown stays till the new one is in.
  useEffect(() => void load(), [load])
  useEffect(() => {
    const events = new EventSource('/events')
    events.onmessage = (e) => {
      // Something changed on disk: what was read may not be what's there.
      texts.current.clear()
      const { changed, paths } = JSON.parse(e.data) as { changed: boolean; paths: string[] }
      // Flash once the new graph is in, so a new file's cell is there to flash.
      const before = shown.current
      const show = () => paths.length && setFlash((f) => ({ paths, kinds: saved(paths, before, shown.current), n: (f?.n ?? 0) + 1 }))
      // Superseded by a later read: no flash, the lines it'd compare aren't this save's.
      if (changed) load().then((landed) => landed && show())
      else show()
    }
    // The server went away and came back (restarted): what it shows may have changed.
    // In dev, that's a rebuilt server: its page may have changed too.
    let opened = false
    events.onopen = () => {
      if (opened) {
        // Files may have changed while it was away: drop what was read.
        texts.current.clear()
        dev ? location.reload() : load()
      }
      opened = true
    }
    // Dev: the page was rebuilt.
    events.addEventListener('reload', () => location.reload())
    return () => events.close()
  }, [load])

  // Packages show by default only when the imports of them, or a package.json's dependencies, changed; the switch overrides that.
  const pkgChanged = useMemo(() => !!data?.packages?.some((e) => e.status !== 'same') || !!data?.declaredChanged?.dep || !!data?.declaredChanged?.dev, [data])
  const [ownShowPkgs, setShowPkgs] = useState<boolean | null>(null)
  const showPkgs = ownShowPkgs ?? pkgChanged
  // devDependencies likewise, among them: by default only when the imports of them, or the devDependencies, changed.
  const devChanged = useMemo(() => !!data?.packages?.some((e) => e.kind === 'dev' && e.status !== 'same') || !!data?.declaredChanged?.dev, [data])
  const [ownShowDev, setShowDev] = useState<boolean | null>(null)
  const showDev = ownShowDev ?? devChanged
  const treeData = useMemo(() => {
    if (!data) return data
    const shown = showDev ? data : { ...data, packages: data.packages?.filter((e) => e.kind !== 'dev') }
    return showPkgs ? withPackageFolder(shown) : shown
  }, [data, showPkgs, showDev])
  const tree = useMemo(() => treeData && buildTree(treeData), [treeData])
  const openFile = useCallback((id: string) => setOpened(isPkgCell(id) ? 'package.json' : id), [])

  return (
    <div className={`arch${sidebar.open ? '' : ' sb-closed'}`}>
      <style>{CSS + SUMMARY_CSS + SIDEBAR_CSS + SHEET_CSS + TABS_CSS + SWITCH_CSS}</style>
      <Sidebar open={sidebar.open} setOpen={sidebar.setOpen}>
        {data && <Summary name={name} worktree={worktree} data={data} hover={hover} onHover={setHover} onOpen={setOpened} titleAside={<SidebarToggle open toggle={sidebar.toggle} />} />}
      </Sidebar>
      <div className="arch-main">
        {opened && <DiffModal state={diff} path={opened} read={read} onClose={close} />}
        {error && <div className="lm-error">{error}</div>}
        {!data && !error && <div className="lm-empty">Reading the module graph…</div>}
        <div className="arch-map" ref={mapRef} style={{ display: data ? 'flex' : 'none' }}>
          {treeData && tree && canvas.width > 0 && (
            <MapView
              data={treeData}
              showPackages={showPkgs}
              onShowPackages={setShowPkgs}
              showDev={showDev}
              onShowDev={setShowDev}
              root={tree.root}
              byId={tree.byId}
              width={canvas.width}
              height={canvas.height}
              // Closed, the sidebar's toggle (beside its title) is here instead.
              barStart={!sidebar.open && <SidebarToggle open={false} toggle={sidebar.toggle} />}
              hover={hover}
              onHover={setHover}
              onOpen={openFile}
              changes={diff?.ok ? diff.files : undefined}
              flash={flash}
              barEnd={
                <Tabs
                  label="What the changes are against"
                  value={mode}
                  onChange={setMode}
                  tabs={[
                    { value: 'branch', label: 'Branch', title: "Against where this branch left the default branch" },
                    { value: 'uncommitted', label: 'Uncommitted', title: 'Against the last commit' },
                  ]}
                />
              }
              keepKey={root}
              restore
              startId={start}
            />
          )}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
