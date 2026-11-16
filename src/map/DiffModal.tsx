import { useEffect, useMemo, useState } from 'react'
import type { DiffFile, State } from '../diff.js'
import { DIFF_CSS, Delta, DiffCode, FileCode, wholeFile } from '../diff-code.js'
import { COLOR } from './theme.js'
import type { FileFate } from './Summary.js'
import { Sheet } from '../sheet.js'

const CSS = `
.sheet .lm-empty { padding: 16px; }
.arch-sheet-delta { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; }
`

/** A diff status as the icon shows it */
const STATUS: Record<DiffFile['status'], FileFate> = { added: 'added', modified: 'modified', deleted: 'removed', renamed: 'moved' }

/** A change's mark, for the header's block: new +, edited •, deleted −, moved → */
function Badge({ fate }: { fate: FileFate }) {
  const glyph = {
    added: <path d="M8 3.5v9M3.5 8h9" />,
    modified: <circle cx={8} cy={8} r={2.5} fill="currentColor" stroke="none" />,
    removed: <path d="M3.5 8h9" />,
    moved: <path d="M3.5 8h8.5M9 4.5 12.5 8 9 11.5" strokeLinejoin="round" />,
  }[fate]
  const label = { added: 'New file', modified: 'Changed file', removed: 'Deleted file', moved: 'Moved file' }[fate]
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-label={label}>
      {glyph}
    </svg>
  )
}

/**
 * A file in a sheet over the Tree: a changed one's text diff (the whole file, its changes
 * in place), from the diff read with the graph, else its code as it is, read on open.
 * Escape, a click outside or its ✕ closes it.
 */
export function DiffModal({ state, path, read, onClose }: { state: State | undefined; path: string; read(path: string): Promise<{ text: string }>; onClose(): void }) {
  // A moved file's old path opens its move too.
  const file = state?.ok ? state.files.find((f) => f.path === path || f.from === path) : undefined
  // Not in the diff: unchanged, or past a truncated diff's cut. Either way, show the file as it is.
  const unchanged = state?.ok && !file
  // Changed: the whole file, its changes in place, once it's read (its hunks alone till then, or if it can't be).
  const wantText = unchanged || (!!file && !file.binary && file.status !== 'deleted')
  const [source, setSource] = useState<{ path: string; text?: string; error?: string }>()
  useEffect(() => {
    if (!wantText) return
    let live = true
    // Opened at a moved file's old path: what's on disk is at its new one.
    read(file?.path ?? path).then(
      (r) => live && setSource({ path, text: r.text }),
      (e) => live && setSource({ path, error: (e as Error).message }),
    )
    return () => void (live = false)
    // A live re-read brings a new diff: the file changed too.
  }, [path, wantText, file])
  const shown = source?.path === path ? source : undefined
  const whole = useMemo(() => (file && shown?.text !== undefined ? wholeFile(file, shown.text) : null), [file, shown])
  /** What happened to it, as its header shows (a move, whatever else: moved) */
  const fate: FileFate | null = file ? (file.from ? 'moved' : STATUS[file.status]) : null
  /** All new or all gone: shown as plain code under a header that says so, not every line coloured */
  const added = fate === 'added'
  const deleted = fate === 'removed'
  const gone = useMemo(() => (deleted && file ? file.hunks.flatMap((h) => h.lines.filter((l) => l.kind === '-').map((l) => l.text)).join('\n') : ''), [deleted, file])
  const cut = path.lastIndexOf('/')
  return (
    <Sheet
      onClose={onClose}
      // In once the file (or that it can't be read) is here: no hunks-then-whole-file or loading-then-code swap as it slides.
      ready={!!state && (!state.ok || !wantText || !!shown)}
      title={<span title={path}>{path.slice(cut + 1)}</span>}
      description={[cut > 0 && path.slice(0, cut) + '/', file ? (file.from ? `moved from ${file.from}` : { added: 'new', modified: 'changed', deleted: 'deleted', renamed: 'renamed' }[file.status]) : 'unchanged'].filter(Boolean).join(' · ')}
      // A changed file's header in its change's colour, a block with its mark at the start.
      tone={fate ? COLOR[fate] : undefined}
      badge={fate && <Badge fate={fate} />}
      aside={
        file && (
          <span className="arch-sheet-delta">
            <Delta added={file.added} removed={file.removed} />
          </span>
        )
      }
    >
      <style>{DIFF_CSS + CSS}</style>
      {!state ? (
        <div className="lm-empty">Loading…</div>
      ) : !state.ok ? (
        <div className="lm-empty">{state.error}</div>
      ) : added && shown?.text !== undefined ? (
        <FileCode path={path} text={shown.text} tone={COLOR.added} />
      ) : deleted ? (
        <FileCode path={path} text={gone} tone={COLOR.removed} />
      ) : file ? (
        whole ? <DiffCode key="whole" file={whole} whole /> : <DiffCode file={file} />
      ) : !shown ? (
        <div className="lm-empty">Loading…</div>
      ) : shown.error !== undefined ? (
        <div className="lm-empty">{shown.error}</div>
      ) : (
        <>
          {state.truncated && <div className="lm-empty">The diff was cut short; this is the file as it is now.</div>}
          <FileCode path={path} text={shown.text ?? ''} />
        </>
      )}
    </Sheet>
  )
}
