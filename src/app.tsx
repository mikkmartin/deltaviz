import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Mode, State } from './diff.js'
import { useKept } from './kept.js'
import { DiffModal } from './map/DiffModal.js'
import { MapView } from './map/MapView.js'
import { isPkgCell, withPackageFolder } from './map/packages.prototype.js'
import type { GraphResponse } from './map/read.js'
import { Summary, SUMMARY_CSS } from './map/Summary.js'
import { T } from './map/theme.js'
import { buildTree } from './map/tree.js'
import { useSize } from './map/useSize.js'
import { blue, gray, red, white } from './palette.js'

/**
 * The page: the repo's Tree, full window, with the Summary beside it. Re-reads
 * when the server says something changed (/events); the Tree keeps its zoom.
 */

declare global {
  interface Window {
    DELTAVIZ: { name: string; root: string; start: string }
  }
}
const { root, start } = window.DELTAVIZ

const CSS = `
* { box-sizing: border-box; }
html, body, #root { margin: 0; height: 100%; background: ${T.canvas}; }
body { font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: ${gray[200]}; color-scheme: dark; }
.arch { display: flex; gap: 14px; height: 100vh; padding: 10px 14px; }
.arch-main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.arch-bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
.arch-bar b { color: ${gray[200]}; }
.arch-check { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: ${gray[400]}; cursor: pointer; user-select: none; }
.arch-grow { flex: 1; }
.arch-seg { display: inline-flex; border: 1px solid ${gray[700]}; border-radius: 6px; overflow: hidden; }
.arch-seg button { all: unset; cursor: pointer; padding: 3px 12px; font-size: 12px; color: ${gray[400]}; }
.arch-seg button.on { background: ${gray[700]}; color: ${gray[200]}; }
.arch-map { flex: 1; min-height: 200px; display: flex; flex-direction: column; overflow: hidden; }
.arch-map svg { display: block; }
.lm-icon-btn { all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; color: ${gray[400]}; flex: none; }
.lm-icon-btn:hover { background: ${gray[800]}; color: ${white}; }
.lm-icon-btn:disabled { opacity: 0.3; cursor: default; }
.lm-muted { color: ${gray[400]}; }
.lm-empty { color: ${gray[400]}; padding: 8px 0; }
.lm-error { color: ${red[500]}; padding: 4px 0; }
a { color: ${blue[400]}; text-decoration: none; }
input[type="checkbox"] { accent-color: ${blue[600]}; margin: 0; flex: none; }
`

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
  const [loading, setLoading] = useState(false)
  const [mapRef, canvas] = useSize()
  /** File or folder under the pointer in the Summary or Tree; each lights it */
  const [hover, setHover] = useState<string | null>(null)
  /** File open over the view: a changed one's diff, else its code */
  const [opened, setOpened] = useState<string | null>(null)
  const close = useCallback(() => setOpened(null), [])
  const read = useCallback((path: string) => get<{ text: string }>(`/file?path=${encodeURIComponent(path)}`), [])
  /** Only the latest read may land */
  const latest = useRef(0)

  const load = useCallback(() => {
    const id = ++latest.current
    setLoading(true)
    get<GraphResponse>(`/graph?mode=${mode}`).then(
      (g) => id === latest.current && (setData(g), setError(''), setLoading(false)),
      (e) => id === latest.current && (setError((e as Error).message), setLoading(false)),
    )
    get<State>(`/diff?mode=${mode}`).then(
      (s) => id === latest.current && setDiff(s),
      (e) => id === latest.current && setDiff({ ok: false, error: (e as Error).message }),
    )
  }, [mode])
  useEffect(() => {
    // Another mode: its diff isn't this one (a live re-read keeps the old one until the new lands).
    setDiff(undefined)
    load()
  }, [load])
  useEffect(() => {
    const events = new EventSource('/events')
    events.onmessage = load
    // The server went away and came back (restarted): what it shows may have changed.
    events.onopen = () => latest.current && load()
    return () => events.close()
  }, [load])

  // Packages show by default only when the imports of them, or a package.json's dependencies, changed; the checkbox overrides that.
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
  const openFile = useCallback((id: string) => !isPkgCell(id) && setOpened(id), [])

  return (
    <div className="arch">
      <style>{CSS + SUMMARY_CSS}</style>
      {data && <Summary data={data} hover={hover} onHover={setHover} onOpen={setOpened} />}
      <div className="arch-main">
        <div className="arch-bar">
          <span className="arch-seg">
            {(['branch', 'uncommitted'] as const).map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                {m === 'branch' ? 'Branch' : 'Uncommitted'}
              </button>
            ))}
          </span>
          <span className="arch-grow" />
          <button className="lm-icon-btn" title="Refresh" onClick={load} disabled={loading}>
            ↻
          </button>
        </div>
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
              height={canvas.height - 40}
              hover={hover}
              onHover={setHover}
              onOpen={openFile}
              changes={diff?.ok ? diff.files : undefined}
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
