import { useMemo, type ReactNode } from 'react'
import { DELTA_CSS, Delta } from '../diff-code.js'
import { COLOR } from './theme.js'
import type { GraphNode, Status } from './model.js'
import { lit, type Pointer } from './pointer.js'
import type { GraphResponse } from './read.js'
import { fmt } from './tree.js'
import { ACCENT, alpha, gray, MONO, white } from '../palette.js'

/** How far a file row's highlight reaches past its text, each side */
const ROW_PAD = 8

export const SUMMARY_CSS = `
.arch-side { box-sizing: border-box; padding: 0 14px 14px ${ROW_PAD}px; overflow: auto; display: flex; flex-direction: column; gap: 14px; font-size: 12px; }
.arch-side h2 { margin: 0; font-size: 22px; line-height: 1.1; letter-spacing: -0.01em; color: ${white}; font-weight: 300; word-break: break-word; }
/* Pinned at the top (the names and the stats) as the rest scrolls under it: opaque, with the panel's top padding, and a fade below so what passes under doesn't cut off hard */
.arch-head { position: sticky; top: 0; z-index: 1; padding: 14px 0 10px; margin-bottom: -10px; background: ${gray[950]}; }
.arch-head::after { content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 12px; background: linear-gradient(${gray[950]}, transparent); pointer-events: none; }
.arch-title { margin-bottom: 2px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.arch-side .sub { margin-top: 1px; font: 11px ${MONO}; color: ${gray[500]}; word-break: break-word; }
.arch-side .sub.branch { color: ${gray[300]}; }
.arch-head .arch-stats { margin-top: 14px; }
.arch-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.arch-stat { background: ${gray[900]}; border-radius: 6px; padding: 8px 10px; color: ${gray[400]}; line-height: 1.3; }
.arch-stat b { display: block; font-size: 17px; color: ${gray[200]}; }
.arch-legend { margin-top: auto; display: flex; flex-direction: column; gap: 5px; color: ${gray[400]}; }
.arch-legend span { display: flex; align-items: center; gap: 8px; }
.arch-legend i { flex: none; width: 12px; height: 9px; border-radius: 2px; border: 1.5px solid; box-sizing: border-box; }
.arch-legend i.line { height: 0; width: 16px; border-width: 1px 0 0; border-radius: 0; }
.arch-files { display: flex; flex-direction: column; font: 11.5px ${MONO}; }
/* A row's highlight reaches ROW_PAD past the text on each side (the panel pads that much on the left, so it isn't cut off); its divider stays in line with the text. */
.arch-files button { all: unset; position: relative; display: flex; gap: 8px; padding: 5px ${ROW_PAD}px; margin: 0 -${ROW_PAD}px; border-radius: 6px; cursor: pointer; }
.arch-files button::after { content: ''; position: absolute; left: ${ROW_PAD}px; right: ${ROW_PAD}px; bottom: 0; height: 1px; background: ${gray[800]}; }
.arch-files button.on, .arch-files button:focus-visible { background: ${gray[800]}; }
.arch-files button.on::after, .arch-files button:focus-visible::after, .arch-files button:has(+ .on)::after { opacity: 0; }
.arch-files button:focus-visible { outline: 1px solid ${ACCENT}; outline-offset: -1px; }
.arch-files .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${gray[200]}; }
.arch-files .removed { text-decoration: line-through; color: ${COLOR.removed}; }
.arch-files .file-icon { flex: none; align-self: center; }
${DELTA_CSS}
`

const ICON = {
  added: { title: 'New file', glyph: <path d="M8 5v6M5 8h6" strokeLinecap="round" /> },
  modified: { title: 'Modified file', glyph: <circle cx={8} cy={8} r={1.75} fill={COLOR.modified} stroke="none" /> },
  removed: { title: 'Deleted file', glyph: <path d="M5 8h6" strokeLinecap="round" /> },
  moved: { title: 'Moved file', glyph: <path d="M4.75 8h6M8.5 5.5 11 8l-2.5 2.5" strokeLinecap="round" /> },
}

export type FileFate = keyof typeof ICON

/** The file's fate: new, edited, deleted or moved, in the status colour */
export function FileIcon({ status }: { status: FileFate }) {
  const { title, glyph } = ICON[status]
  return (
    <svg className="file-icon" width={13} height={13} viewBox="0 0 16 16" fill="none" stroke={COLOR[status]} strokeWidth={1.5} strokeLinejoin="round" aria-label={title}>
      <title>{title}</title>
      <rect x={1.75} y={1.75} width={12.5} height={12.5} rx={2} />
      {glyph}
    </svg>
  )
}

/** The change at a glance, beside the Map and Tree: what moved and how much, with the key to their colours at the bottom. */
export function Summary({ name: project, worktree, data, hover, onHover, onOpen, titleAside }: Pointer & { name: string; worktree: string | null; data: GraphResponse; titleAside?: ReactNode }) {
  const s = useMemo(() => {
    // A move is one entry, under its new path.
    const changed = data.nodes.filter((n): n is GraphNode & { status: Exclude<Status, 'same'> } => n.status !== 'same' && !n.to).sort((a, b) => b.added + b.deleted - (a.added + a.deleted))
    return {
      changed,
      added: changed.reduce((n, f) => n + f.added, 0),
      deleted: changed.reduce((n, f) => n + f.deleted, 0),
      newImports: data.edges.filter((e) => e.status === 'added').length,
      dropped: data.edges.filter((e) => e.status === 'removed').length,
    }
  }, [data])
  const name = (id: string) => id.slice(id.lastIndexOf('/') + 1)
  /** `old.mjs → new.ts`; a move that keeps the name shows the folders: `lib/ → src/util.ts` */
  const label = (f: GraphNode) => {
    if (!f.from) return name(f.id)
    if (name(f.from) !== name(f.id)) return `${name(f.from)} → ${name(f.id)}`
    const folder = (id: string) => name(id.slice(0, Math.max(0, id.lastIndexOf('/')))) || '(repo)'
    return `${folder(f.from)}/ → ${folder(f.id)}/${name(f.id)}`
  }
  return (
    <aside className="arch-side">
      <div className="arch-head">
        <div className="arch-title">
          <h2>{project}</h2>
          {titleAside}
        </div>
        <div className="sub branch" title="Branch">{data.branch ?? 'detached HEAD'}</div>
        {worktree && <div className="sub" title="Worktree">{worktree}</div>}
        <div className="sub">
          {data.baseRef ? `${data.baseRef} @ ${data.baseSha?.slice(0, 7)}` : 'no base branch'}
          {data.dirty > 0 && ` · ${data.dirty} uncommitted`}
        </div>
        <div className="arch-stats">
          <div className="arch-stat">
            <b>
              <Delta added={s.added} removed={s.deleted} format={fmt} />
              {s.added + s.deleted === 0 && 0}
            </b>
            src lines
          </div>
          <div className="arch-stat">
            <b>{s.changed.length}</b>modules touched
          </div>
          <div className="arch-stat">
            <b className={s.newImports ? 'wtc-add' : ''}>{s.newImports ? `+${s.newImports}` : 0}</b>new imports
          </div>
          <div className="arch-stat">
            <b className={s.dropped ? 'wtc-del' : ''}>{s.dropped ? `−${s.dropped}` : 0}</b>dropped imports
          </div>
        </div>
      </div>
      {s.changed.length > 0 && (
        <div className="arch-files" onMouseLeave={() => onHover(null)}>
          {s.changed.map((f) => (
            <button key={f.id} title={f.from ? `${f.from} → ${f.id}` : f.id} className={lit(f.id, hover) ? 'on' : ''} onMouseEnter={() => onHover(f.id)} onFocus={() => onHover(f.id)} onBlur={() => onHover(null)} onClick={() => onOpen(f.id)}>
              <span className={`name${f.status === 'removed' ? ' removed' : ''}`}>{label(f)}</span>
              <Delta added={f.added} removed={f.deleted} />
              <FileIcon status={f.from ? 'moved' : f.status} />
            </button>
          ))}
        </div>
      )}
      <div className="arch-legend">
        <span>
          <i style={{ borderColor: 'transparent', background: alpha(gray[400], 0.3) }} />
          used outside its folder
        </span>
        <span>
          <i style={{ borderColor: alpha(gray[400], 0.45), borderWidth: 1 }} />
          used only inside its folder
        </span>
        <span>
          <i style={{ borderColor: COLOR.added }} />
          added module
        </span>
        <span>
          <i style={{ borderColor: COLOR.modified, background: alpha(COLOR.modified, 0.2) }} />
          modified module
        </span>
        <span>
          <i style={{ borderColor: COLOR.removed, borderStyle: 'dashed' }} />
          removed module
        </span>
        <span>
          <i style={{ borderColor: COLOR.moved }} />
          moved module
        </span>
        <span>
          <i className="line" style={{ borderColor: COLOR.added }} />
          new import
        </span>
        <span>
          <i className="line" style={{ borderColor: COLOR.removed, borderTopStyle: 'dashed' }} />
          dropped import
        </span>
        <span>
          <i className="line" style={{ borderColor: gray[500] }} />
          unchanged import
        </span>
      </div>
    </aside>
  )
}
