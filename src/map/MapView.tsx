import { hierarchy, treemap } from 'd3-hierarchy'
import { alpha, black, mix, MONO, white } from '../palette.js'
import { memo, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DiffFile } from '../diff.js'
import { useKept } from '../kept.js'
import { baseName, edited, fateOf, folderOf, hasHeader, hasTitle, HEADER, renamedAway, renamedHere, type Area, type Fate, type R } from './cell.js'
import { centre, ImportLines, type Link } from './importLines.js'
import { ChangeLine, FileLabel, FolderLabel, RenameLabel } from './labels.js'
import { isPkgCell, PKG_DIR, PKG_DIR_NAME, pkgArea, pkgCellId, PKG_DARKEN, PKG_STROKE, splitTile, packageUses } from './packages.prototype.js'
import type { Graph } from './model.js'
import type { Pointer } from './pointer.js'
import { T } from './theme.js'
import { useSize } from './useSize.js'
import { Switch } from '../switch.js'
import { TABS_INSET } from '../tabs.js'
import { buildTree, exposedFiles, fmt, fmtBytes, startNode, type TreeNode } from './tree.js'

/** Between the bar and the treemap (as .arch-map's gap) */
const BAR_GAP = 10
/** Corners of every cell */
const RADIUS = 6
/** Inside a folder, round what it holds (under its name row, when it has one) */
const PAD = 2
/** Between cells in a folder */
const GAP = 3
/** How far below its name row a hovered folder's accent fades out */
const HEADER_FADE = 24
/** A rectangle with only its top corners rounded */
const topRounded = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
/** A zoom's length, and its easing: slow at both ends, nearly all the travel in the middle */
const ZOOM_MS = 520
const ZOOM_EASE = 'cubic-bezier(.8,0,.2,1)'
/** When, as shares of the zoom, the new view fades in: mid-flight, at its fastest, so the switch isn't seen */
const FADE = [0.4, 0.6] as const
type Box = Pick<R, 'x0' | 'y0' | 'x1' | 'y1'>
/** The transform that fits a whole view (W×H) into the cell `c` */
const into = (c: Box, W: number, H: number) =>
  `matrix(${(c.x1 - c.x0) / W},0,0,${(c.y1 - c.y0) / H},${c.x0},${c.y0})`
/** The transform that blows the cell `c` up to a whole view (W×H) */
const outOf = (c: Box, W: number, H: number) => {
  const sx = W / (c.x1 - c.x0)
  const sy = H / (c.y1 - c.y0)
  return `matrix(${sx},0,0,${sy},${-c.x0 * sx},${-c.y0 * sy})`
}
/** The id of the cell an event happened in */
const idAt = (target: EventTarget) => (target as Element).closest('[data-id]')?.getAttribute('data-id')

/**
 * The whole codebase as a treemap: area = lines, this branch's changes
 * coloured; deleted files keep the area they had, outlined dashed, and a moved file's
 * old spot points to its new one. Click a folder to zoom in, a file for its diff (or its
 * code); hover to see its imports.
 * Files used from outside their folder are a shade lighter, so a folder with a
 * small surface stays mostly dark.
 */
export function MapView(
  props: Pointer & {
    data: Graph
    root: TreeNode
    byId: Map<string, TreeNode>
    width: number
    /** All the room it has, its bar included (the bar wraps when narrow: the treemap gets what's left) */
    height: number
    mini?: boolean
    /** The text diff's files, once read: edited files show where their changes are */
    changes?: DiffFile[]
    /** Files just touched on disk, each with what the save did to its lines: its cell (or the cell it's drawn in) flashes; a new `n` flashes again */
    flash?: { paths: string[]; kinds: Record<string, '+' | '-' | '='>; n: number }
    /** Drawn at the left end of the bar */
    barStart?: ReactNode
    /** Drawn at the right end of the bar */
    barEnd?: ReactNode
    keepKey: string
    restore: boolean
    /** The folder to open zoomed into (where the CLI was run), else the first one with more than one child */
    startId?: string
    /** PROTOTYPE: whether the installed packages are drawn (the switch in the bar) */
    showPackages?: boolean
    onShowPackages?: (on: boolean) => void
    /** PROTOTYPE: whether devDependencies are among them */
    showDev?: boolean
    onShowDev?: (on: boolean) => void
  },
) {
  const { data, root, byId, width, height, mini, onHover: setHover } = props
  const [focusId, setFocusId] = useKept(`${props.keepKey}:focus`, (props.startId && byId.has(props.startId) ? props.startId : null) ?? startNode(root).id, props.restore)
  /** Whether hovering a folder draws its imports (a big one has thousands) */
  const [folderLinks, setFolderLinks] = useKept(`${props.keepKey}:folder-links`, false, props.restore)
  const exposed = useMemo(() => exposedFiles(data), [data])
  const diffs = useMemo(() => new Map((props.changes ?? []).map((f) => [f.path, f])), [props.changes])
  // PROTOTYPE: the root package.json, as a tree file, for the package.json section's header.
  const pkgJson = useMemo(() => (data.pkgJson ? buildTree({ nodes: [data.pkgJson], edges: [] }).byId.get(data.pkgJson.id) : undefined), [data.pkgJson])
  // Short of the bar's right end by the tabs' inset: the selected tab's pill lines up with the treemap's edge (only the tabs' faint ground goes past).
  const W = Math.max(300, width - TABS_INSET)
  const [barRef, bar] = useSize()
  // Less the bar and the gap under it (.arch-map's)
  const H = Math.max(mini ? 120 : 240, height - (bar.height || 30) - BAR_GAP)
  // PROTOTYPE: the package.json section is sized by the square root of bundle bytes.
  const view = useMemo(() => {
    const top = byId.get(focusId) ?? root
    const h = hierarchy(top, (n) => (n.file ? null : n.children.filter((c) => !renamedAway(c))))
      .sum((n) =>
        n.file ? (isPkgCell(n.id) ? pkgArea(n.bytes) : Math.max(1, n.file.status === 'removed' ? n.baseLines : n.lines)) : 0,
      )
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    // Folders pad what they hold, under a row for the name; the zoomed-in one is the canvas, unpadded.
    const pad = (d: { depth: number }) => (d.depth > 0 ? PAD : 0)
    const laid = treemap<TreeNode>()
      // PROTOTYPE: the split variant puts installed packages in their own column.
      .tile(splitTile)
      .size([W, H])
      .paddingTop((d) => (hasHeader(d as R) ? HEADER : pad(d)))
      .paddingLeft(pad)
      .paddingRight(pad)
      .paddingBottom(pad)
      // A gap between what a folder holds.
      .paddingInner(GAP)(h)
    const cells = new Map<string, R>()
    const radius = new Map<string, number>()
    laid.each((d) => {
      cells.set(d.data.id, d as R)
      // Two steps, so neighbours' corners match: small cells stay boxes, not pills.
      const side = Math.min(d.x1 - d.x0, d.y1 - d.y0)
      radius.set(d.data.id, d.depth === 0 ? 0 : side >= 4 * RADIUS ? RADIUS : Math.min(2, side / 4))
    })
    // How deep the folders go here: the deepest gets the darkest tone, however deep that is.
    let deepest = 1
    laid.each((d) => {
      if (!d.data.file) deepest = Math.max(deepest, d.depth)
    })
    return { top, laid, cells, radius, deepest }
  }, [focusId, root, byId, W, H])

  // A hovered file too small to draw (or outside the zoom) lights the cell it's drawn in.
  let hover: string | null = null
  for (let t = props.hover === null ? null : (byId.get(props.hover) ?? null); t && !hover; t = t.parent) {
    if (view.cells.has(t.id)) hover = t.id
  }
  const hoverCell = hover === null || hover === view.top.id ? undefined : view.cells.get(hover)
  // A hovered file lights its folder too, as if that were hovered.
  const holder = hoverCell?.data.file && hoverCell.parent && hoverCell.parent.depth > 0 ? hoverCell.parent : undefined
  const focusCell = holder ?? (hoverCell && !hoverCell.data.file ? hoverCell : undefined)

  // Imports of the hovered file or folder, drawn between cell centres (files outside the view snap to their visible ancestor).
  const links = useMemo(() => {
    if (!hover || (!folderLinks && !byId.get(hover)?.file)) return []
    const inside = (id: string) => id === hover || id.startsWith(hover + '/')
    // Targets merge into cells no deeper than the hovered one: a folder links to folders, a file to files.
    // PROTOTYPE: a package's lines run to the files importing it, however deep they are.
    const depth = isPkgCell(hover) && byId.get(hover)?.file ? Infinity : (view.cells.get(hover)?.depth ?? 1)
    const visible = (id: string): R | undefined => {
      for (let t: TreeNode | null = byId.get(id) ?? null; t; t = t.parent) {
        const c = view.cells.get(t.id)
        if (c && c.depth <= Math.max(1, depth) && (c.x1 - c.x0) * (c.y1 - c.y0) > 30) return c
      }
    }
    const agg = new Map<string, Link>()
    for (const e of data.edges) {
      const out = inside(e.source) && !inside(e.target)
      const inn = inside(e.target) && !inside(e.source)
      if (!out && !inn) continue
      const from = view.cells.get(hover)
      const to = visible(out ? e.target : e.source)
      if (!from || !to || to === from) continue
      const k = `${to.data.id}:${out}`
      const a = agg.get(k) ?? { from, to, out, n: 0, status: 'same' }
      a.n++
      if (e.status !== 'same') a.status = e.status
      agg.set(k, a)
    }
    return [...agg.values()]
  }, [hover, data, view, byId, folderLinks])

  // Moves, old spot → new, between the cells they're drawn in (a folder, when the file is too small).
  const moves = useMemo(() => {
    const drawn = (id: string): R | undefined => {
      for (let t: TreeNode | null = byId.get(id) ?? null; t; t = t.parent) {
        const c = view.cells.get(t.id)
        if (c && (c.x1 - c.x0) * (c.y1 - c.y0) > 30) return c
      }
    }
    const out = new Map<string, { from: R; to: R; ids: string[] }>()
    for (const n of data.nodes) {
      const from = n.from && folderOf(n.from) !== folderOf(n.id) && drawn(n.from)
      const to = from && drawn(n.id)
      if (!from || !to || from === to) continue
      const k = `${from.data.id}\n${to.data.id}`
      out.set(k, { from, to, ids: [...(out.get(k)?.ids ?? []), n.id, n.from!] })
    }
    return [...out.values()]
  }, [data, view, byId])

  // Zooming: the view left behind stays drawn while the new one grows out of the cell clicked
  // (in), or shrinks back into the one it was (out); both fade.
  const [leaving, setLeaving] = useState<Layout | null>(null)
  const current = useRef<SVGGElement>(null)
  const old = useRef<SVGGElement>(null)
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches
  /** PROTOTYPE: toggling packages zooms too: the code, alone, to (or from) where it sits beside them */
  const [pkgZoom, setPkgZoom] = useState<{ code: Box; out: boolean } | null>(null)
  const zoomTo = (id: string) => {
    if (id === view.top.id) return
    if (!still()) {
      setPkgZoom(null)
      setLeaving(view)
    }
    setFocusId(id)
  }
  const shownView = useRef(view)
  const hadPkgs = useRef(props.showPackages)
  useLayoutEffect(() => {
    const [was, had] = [shownView.current, hadPkgs.current]
    shownView.current = view
    hadPkgs.current = props.showPackages
    if (had === props.showPackages || was === view || still()) return
    // Where the code sits in the view with packages: left of them, at the top.
    const withPkgs = props.showPackages ? view : was
    const code = withPkgs.laid.children?.filter((c) => !isPkgCell(c.data.id))
    if (!code?.length || code.length === withPkgs.laid.children?.length) return
    const box = { x0: Math.min(...code.map((c) => c.x0)), y0: Math.min(...code.map((c) => c.y0)), x1: Math.max(...code.map((c) => c.x1)), y1: Math.max(...code.map((c) => c.y1)) }
    setPkgZoom({ code: box, out: !!props.showPackages })
    setLeaving(was)
  }, [view, props.showPackages])
  /** Zooming out: the new view holds the old one */
  let zoomingOut = false
  for (let t: TreeNode | null = leaving?.top.parent ?? null; t && !zoomingOut; t = t.parent) zoomingOut = t === view.top
  if (pkgZoom) zoomingOut = pkgZoom.out
  useLayoutEffect(() => {
    if (!leaving || !current.current || !old.current) return
    // The cell one view is in, in the other (or its nearest drawn ancestor).
    const [outer, inner] = zoomingOut ? [view, leaving] : [leaving, view]
    let cell: Box | undefined = pkgZoom?.code
    for (let t: TreeNode | null = inner.top; t && !cell; t = t.parent) cell = outer.cells.get(t.id)
    if (!cell || cell.x1 - cell.x0 < 1 || cell.y1 - cell.y0 < 1) return (setLeaving(null), setPkgZoom(null))
    const [small, big] = [into(cell, W, H), outOf(cell, W, H)]
    // Each view is opaque (its own canvas under it) and the new one is on top, fading in briefly
    // mid-flight: never a gap, and never two views over each other for long.
    const move = { duration: ZOOM_MS, easing: ZOOM_EASE, fill: 'both' } as const
    const fade = (from: number, to: number) => ({ delay: ZOOM_MS * from, duration: ZOOM_MS * (to - from), easing: 'linear', fill: 'both' }) as const
    const runs = [
      current.current.animate([{ transform: zoomingOut ? big : small }, { transform: 'none' }], move),
      old.current.animate([{ transform: 'none' }, { transform: zoomingOut ? small : big }], move),
      current.current.animate([{ opacity: 0 }, { opacity: 1 }], fade(...FADE)),
    ]
    runs[0].finished.then(() => (setLeaving(null), setPkgZoom(null)), () => {})
    return () => runs.forEach((r) => r.cancel())
    // Once per zoom: the views it runs between are set when it starts.
  }, [leaving])

  // PROTOTYPE: who imports the hovered package (or folder of them), outlined.
  const uses = useMemo(() => (props.showPackages ? packageUses(data) : []), [data, props.showPackages])
  const hoveredPkgs = useMemo(() => {
    if (hover === null || !isPkgCell(hover)) return []
    return uses.filter((u) => pkgCellId(u) === hover || pkgCellId(u).startsWith(hover + '/')).map((u) => u.name)
  }, [hover, uses])
  const importers = useMemo(() => {
    const out = new Map<string, R>()
    for (const f of uses.filter((u) => hoveredPkgs.includes(u.name)).flatMap((u) => [...u.files])) {
      for (let t: TreeNode | null = byId.get(f) ?? null; t; t = t.parent) {
        const c = view.cells.get(t.id)
        if (c && c.depth > 0) {
          out.set(c.data.id, c)
          break
        }
      }
    }
    return [...out.values()]
  }, [hoveredPkgs, uses, byId, view])
  const pkgLayer = !mini && (
    <g pointerEvents="none">
      {/* A package's importers, in the colour of the lines to them (imported by) */}
      {importers.map((c) => (
        <rect key={c.data.id} x={c.x0 + 0.75} y={c.y0 + 0.75} width={Math.max(0, c.x1 - c.x0 - 1.5)} height={Math.max(0, c.y1 - c.y0 - 1.5)} rx={view.radius.get(c.data.id)}
          fill="none" stroke={T.importIn} strokeWidth={1.5} />
      ))}
    </g>
  )

  // The view as it is: its cells, and what's drawn over them.
  const drawn = (
    <>
      <rect width={W} height={H} fill={T.canvas} />
      <Cells view={view} exposed={exposed} diffs={diffs} pkgJson={pkgJson} />
      <Beacons view={view} exposed={exposed} />
      {/* Over the cells (folders are solid): a hovered folder (or a hovered file's), faintly lit. */}
      {focusCell && <rect x={focusCell.x0} y={focusCell.y0} width={focusCell.x1 - focusCell.x0} height={focusCell.y1 - focusCell.y0} rx={view.radius.get(focusCell.data.id)} fill={alpha(T.ink, 0.07)} pointerEvents="none" />}
      {holder && <HoverLayer view={view} cell={holder} pkgJson={pkgJson} diffs={diffs} />}
      {hoverCell && <HoverLayer view={view} cell={hoverCell} pkgJson={pkgJson} diffs={diffs} />}
      <defs>
        {/* PROTOTYPE: a package that adds nothing to a bundle (a node builtin, or not installed): hatched */}
        <pattern id="lm-pkg-free" width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={6} stroke={alpha(T.ink, 0.18)} strokeWidth={1.5} />
        </pattern>
        <marker id="lm-move-head" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={5} markerHeight={5} orient="auto">
          <path d="M0 0 8 4 0 8z" fill={T.moved} stroke={T.shade} strokeWidth={1} strokeLinejoin="round" />
        </marker>
      </defs>
      {moves.map((m) => {
        const { x: x1, y: y1 } = centre(m.from)
        const { x: x2, y: y2 } = centre(m.to)
        const mx = (x1 + x2) / 2 + (y2 - y1) * 0.25
        const my = (y1 + y2) / 2 - (x2 - x1) * 0.25
        const lit = !!hover && [m.from.data.id, m.to.data.id, ...m.ids].includes(hover)
        const width = Math.min(4, 1.25 + Math.log2(m.ids.length / 2))
        const d = `M${x1},${y1}Q${mx},${my} ${x2},${y2}`
        // A dark casing under the white dashes keeps the arrow visible over the white cell it lands in.
        return (
          <g key={`${m.from.data.id}\n${m.to.data.id}`} fill="none" opacity={lit ? 1 : 0.85} pointerEvents="none">
            <path d={d} stroke={T.shade} strokeWidth={width + 2} strokeOpacity={0.6} />
            <path d={d} stroke={T.moved} strokeWidth={width} strokeDasharray="5 3" markerEnd="url(#lm-move-head)" />
          </g>
        )
      })}
      {props.flash && <Flash view={view} byId={byId} flash={props.flash} pkgJson={pkgJson} />}
      {hoverCell && links.length > 0 && <ImportLines links={links} from={hoverCell} radius={view.radius.get(hoverCell.data.id) ?? 0} />}
      {pkgLayer}
    </>
  )

  const crumbs: TreeNode[] = []
  for (let t: TreeNode | null = view.top; t; t = t.parent) crumbs.unshift(t)
  return (
    <>
      <div className="arch-bar" ref={barRef}>
        {props.barStart}
        {/* Zoomed in: the way back out. At the top there's nowhere to go. */}
        {crumbs.length > 1 && <span className="arch-seg">
          {crumbs.map((c, i) => (
            <button key={c.id || 'root'} onClick={() => zoomTo(c.id)} className={i === crumbs.length - 1 ? 'on' : ''}>
              {c.id === '' ? '(repo)' : c.name}
            </button>
          ))}
        </span>}
        {!mini && <span className="lm-muted">
          {fmt(view.top.lines)} lines · {view.top.files} files{view.top.changed ? ` · ${view.top.changed} changed` : ''} · hover: <span style={{ color: T.importOut }}>imports</span> /{' '}
          <span style={{ color: T.importIn }}>imported by</span>
          {/* PROTOTYPE: the package.json section's key: its areas aren't linear, its labels are real. */}
          {props.showPackages && <span title="A package's area is the square root of its bundle size (from 1 KB); its label is the real size"> · packages ∝ √size</span>}
        </span>}
        <span className="arch-grow" />
        {!mini && (
          <Switch label="packages" title="Show the installed packages the code imports (on by default when this branch changes which it imports)" checked={!!props.showPackages} onToggle={() => props.onShowPackages?.(!props.showPackages)} />
        )}
        {!mini && (
          <Switch label="devDependencies" title="Include devDependencies among the packages (on by default when this branch changes which it imports)" disabled={!props.showPackages} checked={!!props.showDev} onToggle={() => props.onShowDev?.(!props.showDev)} />
        )}
        {!mini && (
          <Switch label="show folder dependencies on hover" title="Draw a folder's imports when hovering it" checked={folderLinks} onToggle={() => setFolderLinks(!folderLinks)} />
        )}
        {props.barEnd}
      </div>
        <svg
          width={W}
          height={H}
          style={{ display: 'block', flex: 'none' }}
          // One set of handlers for all cells (each carries its id): cells don't re-render on hover.
          // Mid-zoom, the new view isn't where it will be: no hovering or clicking it.
          onMouseOver={(e) => {
            if (leaving) return
            const id = idAt(e.target)
            if (id != null) setHover(id)
          }}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            if (leaving) return
            const id = idAt(e.target)
            const c = id == null ? undefined : view.cells.get(id)
            if (!c) return
            // PROTOTYPE: the package.json section (a package, or the section itself) opens package.json.
            if (c.data.file || isPkgCell(c.data.id)) props.onOpen(c.data.id)
            else if (c.depth > 0) zoomTo(c.data.id)
          }}
        >
          {/* While zooming, the view left, under the new one. */}
          {leaving && (
            <g ref={old} pointerEvents="none">
              <rect width={W} height={H} fill={T.canvas} />
              <Cells view={leaving} exposed={exposed} diffs={diffs} pkgJson={pkgJson} />
            </g>
          )}
          <g ref={current}>{drawn}</g>
        </svg>
    </>
  )
}

/**
 * A folder's fill, solid: the outermost lightest, the deepest in view darkest, evenly between.
 * The range is the same whatever the depth: two levels or ten, the deepest has the same tone.
 */
const FOLDER_LIGHT = 0.16
const FOLDER_DARK = 0.03
/** A folder's outline */
const FOLDER_STROKE = alpha(T.ink, 0.15)
const folderFill = (depth: number, deepest: number) =>
  mix(T.canvas, T.ink, deepest <= 1 ? FOLDER_LIGHT : FOLDER_LIGHT + ((FOLDER_DARK - FOLDER_LIGHT) * (depth - 1)) / (deepest - 1))

/**
 * A file's fill: an edited one (moved or not) a hint of amber, where it changed is the line
 * under its name; unchanged ones lighter when something outside their folder imports them.
 */
function fill(t: TreeNode, fate: Fate, exposed: Set<string>): string {
  // Faint: a stronger amber over the dark reads as brown; the outline and name carry the colour.
  if (edited(t)) return alpha(T.modified, 0.04)
  const unchanged = alpha(T.ink, exposed.has(t.id) ? 0.14 : 0.03)
  return { movedHere: alpha(T.moved, 0.16), movedAway: alpha(T.moved, 0.07), deleted: alpha(T.removed, 0.14), added: alpha(T.added, 0.25) }[fate as string] ?? unchanged
}

/** A file's outline; an unchanged one nothing outside its folder imports is drawn hollow */
function stroke(t: TreeNode, fate: Fate, exposed: Set<string>): string {
  if (fate === 'movedHere') return alpha(T.moved, 0.6)
  if (fate === 'movedAway') return T.moved
  if (fate === 'deleted') return T.removed
  if (edited(t)) return alpha(T.modified, 0.45)
  if (fate === 'added') return T.added
  return exposed.has(t.id) ? 'none' : alpha(T.ink, 0.2)
}

/** A changed file's name: in its fate's colour, struck through when deleted */
const NAME: Partial<Record<Fate, string>> = { movedAway: T.moved, deleted: T.removed, edited: T.modified, added: T.added }

/** What a cell's area and size label stand for: code is sized by lines; PROTOTYPE: packages by bundle bytes */
const areaOf = (id: string): Area => (isPkgCell(id) ? 'bytes' : 'lines')

/** The laid-out treemap MapView draws */
type Layout = { top: TreeNode; laid: R; cells: Map<string, R>; radius: Map<string, number>; deepest: number }

/**
 * Every cell of the treemap, as it is with nothing hovered: drawn once per layout, data
 * or diff, never on hover (HoverLayer draws over it). Thousands of cells in a big repo.
 */
const Cells = memo(function Cells({ view, exposed, diffs, pkgJson }: { view: Layout; exposed: Set<string>; diffs: Map<string, DiffFile>; pkgJson?: TreeNode }) {
  return (
    <>
      {view.laid.descendants().map((d) => {
        const t = d.data
        const area = areaOf(t.id)
        const w = d.x1 - d.x0
        const h = d.y1 - d.y0
        const fate = fateOf(t)
        const line =
          d.depth === 0 ? 'none' : isPkgCell(t.id) && (fate === 'same' || fate === 'folder') ? alpha(T.ink, PKG_STROKE) : t.file ? stroke(t, fate, exposed) : FOLDER_STROKE
        // The outline sits inside the cell: inset by half its width (a stroke straddles the edge).
        const inset = line === 'none' ? 0 : 0.5
        return (
          <g key={t.id || 'root'} data-id={t.id} style={{ cursor: t.file || isPkgCell(t.id) ? 'pointer' : 'zoom-in' }}>
            <title>{`${isPkgCell(t.id) ? PKG_DIR_NAME + t.id.slice(PKG_DIR.length) : t.id}\n${
              fate === 'movedAway'
                ? `moved to ${t.file!.to}, ${fmt(t.baseLines)} lines`
                : fate === 'deleted'
                  ? `deleted, ${fmt(t.baseLines)} lines`
                  : `${fmt(t.lines)} lines · ${t.files} files${t.file?.from ? `, ${fate === 'movedHere' ? 'moved' : 'renamed'} from ${t.file.from}` : ''}`
            }${t.changed ? `, ${t.changed} changed (+${t.added} −${t.deleted})` : ''}${t.file?.bundled ? `\nwhat's imported bundles to ${fmtBytes(t.file.bundled.bytes)} (${fmtBytes(t.file.bundled.gzip)} gzipped)${t.file.bundled.installed ? `; ${fmtBytes(t.file.bundled.installed)} installed` : ''}` : ''}`}</title>
            <rect
              x={d.x0 + inset}
              y={d.y0 + inset}
              width={Math.max(0, w - 2 * inset)}
              height={Math.max(0, h - 2 * inset)}
              rx={Math.max(0, (view.radius.get(t.id) ?? 0) - inset)}
              // The zoomed-in folder is the canvas itself: no fill or outline.
              // PROTOTYPE: the package.json section is darker; a package's change (new, dropped) keeps its colour.
              fill={
                d.depth === 0
                  ? 'transparent'
                  : t.file
                    ? isPkgCell(t.id) && fate === 'same' ? (t.bytes ? alpha(T.ink, 0.05) : 'url(#lm-pkg-free)') : fill(t, fate, exposed)
                    : isPkgCell(t.id) ? mix(folderFill(d.depth, view.deepest), T.canvas, PKG_DARKEN) : folderFill(d.depth, view.deepest)
              }
              stroke={line}
              // Dashed: deleted. A moved file's old spot is solid, in the move's colour.
              strokeDasharray={fate === 'deleted' ? '3 2' : undefined}
            />
            {edited(t) && <ChangeLine cell={d} diff={diffs.get(t.id)} />}
            {!t.file && hasHeader(d) && (t.id === PKG_DIR && pkgJson && edited(pkgJson) ? <PkgJsonHeader cell={d} file={pkgJson} diff={diffs.get(pkgJson.id)} /> : <FolderLabel cell={d} area={area} detail={false} />)}
            {t.file && !edited(t) && !renamedHere(t) && w > 40 && h > 26 && (
              <text x={d.x0 + 3} y={d.y0 + 22} fontSize={8.5} fill={t.file.status === 'added' ? T.addedSize : T.dim} fontFamily={MONO} pointerEvents="none">
                {(area === 'bytes'
                  ? fmtBytes(t.file.status === 'removed' ? t.baseBytes : t.bytes)
                  : `${fmt(t.file.status === 'removed' ? t.baseLines : t.lines)} lines`
                ).slice(0, Math.floor(w / 5.3))}
              </text>
            )}
            {t.file && fate === 'same' && hasTitle(d) && (
              <text x={d.x0 + 3} y={d.y0 + 11} fontSize={9.5} fill={T.text} fontFamily={MONO} pointerEvents="none">
                {t.name.slice(0, Math.floor(w / 6))}
              </text>
            )}
            {t.file && fate !== 'same' && hasTitle(d) && (
              <FileLabel t={t} cell={d}>
                {(chars) => (
                  <text
                    x={d.x0 + 3}
                    y={d.y0 + 11}
                    fontSize={9.5}
                    fill={(edited(t) ? T.modified : NAME[fate]) ?? T.text}
                    textDecoration={fate === 'deleted' ? 'line-through' : undefined}
                    fontFamily={MONO}
                    pointerEvents="none"
                  >
                    {renamedHere(t) ? (
                      // Two lines would run into an edited file's change line.
                      <RenameLabel from={baseName(t.file!.from!)} to={t.name} x={d.x0 + 3} chars={chars} lines={h > 28 && !edited(t) ? 2 : 1} />
                    ) : (
                      t.name.slice(0, chars)
                    )}
                  </text>
                )}
              </FileLabel>
            )}
          </g>
        )
      })}
    </>
  )
})

/**
 * PROTOTYPE: the package.json section's header when the root package.json changed: its name
 * in the edited colour, the file's `+a−d` at the right, and where it changed under them.
 */
function PkgJsonHeader({ cell, file, diff }: { cell: R; file: TreeNode; diff?: DiffFile }) {
  // Set as a folder's name row is (FolderLabel), so hovering the section doesn't move it.
  const chars = Math.floor((cell.x1 - cell.x0 - 8) / 6.3)
  const added = file.added > 0 ? `+${fmt(file.added)}` : ''
  const deleted = file.deleted > 0 ? `−${fmt(file.deleted)}` : ''
  const counts = PKG_DIR_NAME.length + 2 + added.length + deleted.length <= chars
  // As the file's own cell would be, at the top of the section: the change line (4px at 16px down) ends at the name row's bottom.
  const row = { ...cell, data: file, y1: cell.y0 + Math.max(HEADER, 24) } as R
  const text = { y: cell.y0 + 13, fontSize: 10, fontFamily: MONO, pointerEvents: 'none' } as const
  return (
    <>
      <text x={cell.x0 + 4} fill={T.modified} {...text}>
        {PKG_DIR_NAME.slice(0, chars)}
      </text>
      {counts && (
        <text x={cell.x1 - 5} textAnchor="end" {...text}>
          <tspan fill={T.added}>{added}</tspan>
          <tspan fill={T.removed}>{deleted}</tspan>
        </text>
      )}
      <ChangeLine cell={row} diff={diff} />
    </>
  )
}

/** A changed file's colour, as its name's */
const fateColor = (t: TreeNode, fate: Fate) => (edited(t) ? T.modified : (NAME[fate] ?? (fate === 'renamed' ? T.added : undefined)))

/** A beacon's side */
const BEACON = 9

/**
 * Changed files too small to draw, a side under a pixel (the outline's inset leaves nothing;
 * a few lines in a big repo can be that small):
 * a small square over the middle of the cell, outlined as the file is, with a dot in its colour,
 * so they're seen from the top. Hovered and clicked as the file itself.
 */
function Beacons({ view, exposed }: { view: Layout; exposed: Set<string> }) {
  return (
    <>
      {view.laid.leaves().map((d) => {
        const t = d.data
        const color = t.file && !isPkgCell(t.id) && Math.min(d.x1 - d.x0, d.y1 - d.y0) < 1 ? fateColor(t, fateOf(t)) : undefined
        if (!color) return null
        const fate = fateOf(t)
        const x = (d.x0 + d.x1) / 2
        const y = (d.y0 + d.y1) / 2
        // Inset half the outline, as a file's is.
        const side = BEACON - 1
        return (
          <g key={t.id} data-id={t.id} style={{ cursor: 'pointer' }}>
            <rect x={x - side / 2} y={y - side / 2} width={side} height={side} rx={1.5} fill={mix(T.canvas, color, 0.25)} stroke={stroke(t, fate, exposed)} strokeDasharray={fate === 'deleted' ? '3 2' : undefined} />
            <circle cx={x} cy={y} r={1.5} fill={color} />
          </g>
        )
      })}
    </>
  )
}

/** How long a touched file's flash takes to fade */
const FLASH_MS = 900

/** A flash's colour: by what the save did to the file's lines */
const FLASH_COLOR = { '+': T.added, '-': T.removed, '=': T.ink }

/**
 * Touched files, flashed over the cells by what the save did, fading out: green when it added
 * lines, red when it removed them, gray when it neither (an edit in place). A file too small to
 * draw, or outside the zoom, flashes the cell it's drawn in; one gone (not in the tree) the
 * nearest folder that is. PROTOTYPE: with the package.json section drawn, the root package.json
 * flashes the section.
 */
const Flash = memo(function Flash({ view, byId, flash, pkgJson }: { view: Layout; byId: Map<string, TreeNode>; flash: { paths: string[]; kinds: Record<string, '+' | '-' | '='>; n: number }; pkgJson?: TreeNode }) {
  const cells = new Map<string, { cell: R; color: string }>()
  for (const p of flash.paths) {
    const color = FLASH_COLOR[flash.kinds[p] ?? '=']
    let at: TreeNode | null = null
    if (pkgJson && p === pkgJson.id) at = byId.get(PKG_DIR) ?? null
    else {
      let id: string | null = p
      while (id !== null && !byId.has(id)) id = id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : id ? '' : null
      at = id === null ? null : (byId.get(id) ?? null)
    }
    for (let t = at; t; t = t.parent) {
      const c = view.cells.get(t.id)
      if (c && c.depth > 0) {
        // Several files in one cell: a change's colour over the neutral.
        if (!cells.has(c.data.id) || color !== T.ink) cells.set(c.data.id, { cell: c, color })
        break
      }
    }
  }
  return (
    <g pointerEvents="none">
      {[...cells.values()].map(({ cell: c, color }) => (
        <rect key={`${flash.n}:${c.data.id}`} x={c.x0} y={c.y0} width={c.x1 - c.x0} height={c.y1 - c.y0} rx={view.radius.get(c.data.id)}
          fill={color} opacity={0} style={{ animation: `dv-flash ${FLASH_MS}ms ease-out` }} />
      ))}
    </g>
  )
})

/**
 * What hovering adds over the cells, so they never redraw for it. A file: a white outline.
 * A folder: its name row in the accent with its change stats, what it holds lit a
 * little, and its direct subfolders outlined and named in white, or itself outlined when it has none.
 */
const HoverLayer = memo(function HoverLayer({ view, cell, pkgJson, diffs }: { view: Layout; cell: R; pkgJson?: TreeNode; diffs: Map<string, DiffFile> }) {
  const t = cell.data
  const w = cell.x1 - cell.x0
  const r = (c: R) => view.radius.get(c.data.id) ?? 0
  const outline = (c: R, color: string, width: number) => (
    <rect
      key={c.data.id}
      x={c.x0 + width / 2}
      y={c.y0 + width / 2}
      width={Math.max(0, c.x1 - c.x0 - width)}
      height={Math.max(0, c.y1 - c.y0 - width)}
      rx={Math.max(0, r(c) - width / 2)}
      fill="none"
      stroke={color}
      strokeWidth={width}
    />
  )
  if (t.file) return <g pointerEvents="none">{outline(cell, T.hover, 1.5)}</g>
  const subfolders = (cell.children ?? []).filter((c) => c.children)
  return (
    <g pointerEvents="none">
      {hasHeader(cell) && (
        <>
          {/* The name row in the accent (as the outlines), fading out below it, around the rounded tops of what
              the folder holds (masked out where they are). */}
          <linearGradient id="lm-head-fade" gradientUnits="userSpaceOnUse" x1={0} y1={cell.y0 + HEADER} x2={0} y2={cell.y0 + HEADER + HEADER_FADE}>
            <stop offset={0} stopColor={T.accent} stopOpacity={1} />
            <stop offset={1} stopColor={T.accent} stopOpacity={0} />
          </linearGradient>
          <mask id="lm-head">
            <rect x={cell.x0} y={cell.y0} width={w} height={HEADER + HEADER_FADE} fill={white} />
            {cell.children?.map((c) => <rect key={c.data.id} x={c.x0} y={c.y0} width={c.x1 - c.x0} height={c.y1 - c.y0} rx={r(c)} fill={black} />)}
          </mask>
          <path d={topRounded(cell.x0, cell.y0, w, HEADER + HEADER_FADE, r(cell))} fill="url(#lm-head-fade)" mask="url(#lm-head)" />
          {t.id === PKG_DIR && pkgJson && edited(pkgJson) ? (
            <PkgJsonHeader cell={cell} file={pkgJson} diff={diffs.get(pkgJson.id)} />
          ) : (
            <FolderLabel cell={cell} area={areaOf(cell.data.id)} detail />
          )}
        </>
      )}
      {/* What it holds, lit a little */}
      {cell.descendants().map((c) => c.data.file && <rect key={c.data.id} x={c.x0} y={c.y0} width={c.x1 - c.x0} height={c.y1 - c.y0} rx={r(c)} fill={alpha(T.hover, 0.06)} />)}
      {subfolders.length ? subfolders.map((c) => outline(c, T.accent, 1)) : outline(cell, T.accent, 1)}
      {/* Drawn over their own names */}
      {subfolders.map((c) => hasHeader(c) && <FolderLabel key={c.data.id} cell={c} area={areaOf(c.data.id)} detail={false} lit />)}
    </g>
  )
})
