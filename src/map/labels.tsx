/** What the Tree writes on its cells: names, sizes, change counts, where a file changed. */
import type { ReactNode } from 'react'
import type { DiffFile } from '../diff.js'
import { edited, fateOf, hasTitle, HEADER, type Area, type R } from './cell.js'
import { changeRuns, type Run } from './runs.js'
import { MONO } from '../palette.js'
import { T } from './theme.js'
import { fmt, fmtBytes, type TreeNode } from './tree.js'


/**
 * A rename in place: the old name struck through in red, then the new one in green, on one line if
 * both fit (`old → new`), else old above new when there's room for two, else just new.
 */
export function RenameLabel({ from, to, x, chars, lines }: { from: string; to: string; x: number; chars: number; lines: 1 | 2 }) {
  const old = (text: string) => (
    <tspan fill={T.removed} textDecoration="line-through">
      {text}
    </tspan>
  )
  const now = (text: string) => <tspan fill={T.added}>{text}</tspan>
  if (from.length + 3 + to.length <= chars) {
    return (
      <>
        {old(from)}
        <tspan fill={T.hover}> → </tspan>
        {now(to)}
      </>
    )
  }
  if (lines === 1) return now(to.slice(0, chars))
  return (
    <>
      {old(from.slice(0, chars))}
      <tspan x={x} dy={12} fill={T.added}>
        {to.slice(0, chars)}
      </tspan>
    </>
  )
}

/**
 * A changed file's name, and for an edited one its `+a−d` at the right of the same
 * line, when both fit. `children` draws the name in the characters left for it.
 */
export function FileLabel({ t, cell, children }: { t: TreeNode; cell: R; children: (chars: number) => ReactNode }) {
  const w = cell.x1 - cell.x0
  const count = edited(t) ? [t.added > 0 && `+${fmt(t.added)}`, t.deleted > 0 && `−${fmt(t.deleted)}`].filter(Boolean).join('') : ''
  const countW = count.length * 5.5 + 8
  const withCount = !!count && w - countW > 6 * 4
  return (
    <>
      {children(Math.floor((w - (withCount ? countW : 0)) / 6))}
      {withCount && (
        <text x={cell.x1 - 4} y={cell.y0 + 11} textAnchor="end" fontSize={9} fontFamily={MONO} pointerEvents="none">
          {t.added > 0 && <tspan fill={T.added}>+{fmt(t.added)}</tspan>}
          {t.deleted > 0 && <tspan fill={T.removed}>−{fmt(t.deleted)}</tspan>}
        </text>
      )}
    </>
  )
}

/** A changed folder's colour: green when every file it changed is a whole new one, red when every one was deleted, else amber */
function changeColor(t: TreeNode): string {
  const fates = new Set<string>()
  const walk = (n: TreeNode) => (n.file ? fateOf(n) !== 'same' && fates.add(fateOf(n)) : n.children.forEach(walk))
  walk(t)
  return fates.size === 1 && fates.has('added') ? T.added : fates.size === 1 && fates.has('deleted') ? T.removed : T.modified
}

/**
 * A folder's name and size, coloured by its changes (see changeColor). `detail` (the folder itself is
 * hovered): on its accent name row, a changed folder's lines added and removed and
 * how many of its files changed in place of its size, at the row's end
 * (`map … 10/16 · +904−112`), as far as fits. `lit` (its parent is hovered): its name in white.
 */
export function FolderLabel({ cell, area, detail, lit }: { cell: R; area: Area; detail: boolean; lit?: boolean }) {
  const t = cell.data
  const chars = Math.floor((cell.x1 - cell.x0 - 8) / 6.3)
  const added = t.added > 0 ? `+${fmt(t.added)}` : ''
  const deleted = t.deleted > 0 ? `−${fmt(t.deleted)}` : ''
  const share = `${t.changed}/${t.files} · `
  const name = `${t.name}  `
  const text = (children: ReactNode) => (
    <text x={cell.x0 + 4} y={cell.y0 + 13} fontSize={10} fontFamily={MONO} pointerEvents="none">
      {children}
    </text>
  )
  if (!t.changed || !detail) {
    // The size in gray: only the name says whether the folder changed.
    const size = area === 'bytes' ? fmtBytes(t.bytes) : fmt(t.lines)
    const shown = name.slice(0, chars)
    return text(
      <>
        <tspan fill={detail ? T.onAccent : lit ? T.hover : t.changed ? changeColor(t) : T.muted}>{shown}</tspan>
        {shown.length === name.length && <tspan fill={detail ? T.onAccentMuted : lit ? T.muted : T.dim}>{size.slice(0, chars - name.length)}</tspan>}
      </>,
    )
  }
  // The counts at the row's end. Drop the share, then the counts, before cutting the name.
  const counts = name.length + added.length + deleted.length <= chars
  const withShare = counts && name.length + added.length + deleted.length + share.length <= chars
  return (
    <>
      {text(<tspan fill={T.onAccent}>{counts ? t.name : t.name.slice(0, chars)}</tspan>)}
      {counts && (
        <text x={cell.x1 - 5} y={cell.y0 + 13} textAnchor="end" fontSize={10} fontFamily={MONO} pointerEvents="none">
          {withShare && <tspan fill={T.onAccentMuted}>{share}</tspan>}
          <tspan fill={T.addedOnAccent}>{added}</tspan>
          <tspan fill={T.removedOnAccent}>{deleted}</tspan>
        </text>
      )}
    </>
  )
}

/**
 * Where an edited file changed, under its name (or at the top of a cell too small for
 * one): a line standing for the file top to bottom (left to right), marked green
 * where lines were added and red where removed. Without its diff (not read yet, or cut
 * off), the changes show at the end.
 */
export function ChangeLine({ cell, diff }: { cell: R; diff?: DiffFile }) {
  const t = cell.data
  // Under the name; a cell too small for one has the line at its top, edge to edge.
  const named = hasTitle(cell)
  const pad = named ? 4 : 2
  const x = cell.x0 + pad
  const w = cell.x1 - cell.x0 - 2 * pad
  const y = cell.y0 + (named ? 16 : 2)
  if (w < 6 || cell.y1 - cell.y0 < (named ? 24 : 7)) return null
  // Lines as the diff counts them: every line, blank ones too (the graph's `lines` skips those).
  const length = t.file?.length ?? t.lines
  let { runs, total } = diff?.hunks.length ? changeRuns(diff, length) : { runs: [] as Run[], total: length + t.deleted }
  total = Math.max(1, total, t.added + t.deleted)
  if (!runs.length) {
    runs = [
      { kind: '-' as const, start: total - t.added - t.deleted, count: t.deleted },
      { kind: '+' as const, start: total - t.added, count: t.added },
    ].filter((r) => r.count > 0)
  }
  // Kept inside the line, whatever the counts say.
  const at = (n: number) => x + (w * Math.min(Math.max(n, 0), total)) / total
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={w} height={4} rx={2} fill={T.ink} fillOpacity={0.14} />
      {runs.map((r, i) => {
        const x0 = Math.min(at(r.start), x + w - 2)
        return <rect key={i} x={x0} y={y} width={Math.max(2, Math.min(at(r.start + r.count), x + w) - x0)} height={4} rx={1} fill={r.kind === '+' ? T.added : T.removed} />
      })}
    </g>
  )
}
