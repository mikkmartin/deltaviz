import { useEffect, useState } from 'react'
import type { DiffFile, State } from '../diff.js'
import { DIFF_CSS, Delta, DiffCode, FileCode } from '../diff-code.js'
import { FileIcon, type FileFate } from './Summary.js'
import { alpha, black, gray } from '../palette.js'

const CSS = `
.arch-modal { position: fixed; inset: 0; z-index: 10; background: ${alpha(gray[950], 0.6)}; display: flex; align-items: center; justify-content: center; padding: 32px; }
.arch-modal > div { width: min(1100px, 100%); max-height: 100%; display: flex; flex-direction: column; background: ${gray[950]}; border: 1px solid ${gray[700]}; border-radius: 10px; overflow: hidden; box-shadow: 0 16px 48px ${alpha(black, 0.5)}; }
.arch-modal header { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: ${gray[900]}; border-bottom: 1px solid ${gray[700]}; font: 12.5px ui-monospace, monospace; }
.arch-modal header .path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${gray[200]}; }
.arch-modal .wtc-code { overflow: auto; padding: 4px 0; }
.arch-modal .lm-empty { padding: 16px; }
`

/** A diff status as the icon shows it */
const STATUS: Record<DiffFile['status'], FileFate> = { added: 'added', modified: 'modified', deleted: 'removed', renamed: 'moved' }

/**
 * A file over the Map or Tree: a changed one's text diff, from the diff MapTab
 * read with the graph, else its code as it is, read on open. Escape or a click
 * outside closes it (the panel stays open).
 */
export function DiffModal({ state, path, read, onClose }: { state: State | undefined; path: string; read(path: string): Promise<{ text: string }>; onClose(): void }) {
  useEffect(() => {
    // Capture: ahead of the frame's own Escape, which would close the panel.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopImmediatePropagation(), onClose())
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [onClose])

  // A moved file's old path opens its move too.
  const file = state?.ok ? state.files.find((f) => f.path === path || f.from === path) : undefined
  // Not in the diff: unchanged, or past a truncated diff's cut. Either way, show the file as it is.
  const unchanged = state?.ok && !file
  const [source, setSource] = useState<{ path: string; text?: string; error?: string }>()
  useEffect(() => {
    if (!unchanged) return
    let live = true
    read(path).then(
      (r) => live && setSource({ path, text: r.text }),
      (e) => live && setSource({ path, error: (e as Error).message }),
    )
    return () => void (live = false)
  }, [path, unchanged])
  const shown = source?.path === path ? source : undefined
  return (
    <div className="arch-modal" onClick={onClose}>
      <style>{DIFF_CSS + CSS}</style>
      <div onClick={(e) => e.stopPropagation()}>
        <header>
          <span className="path" title={path}>
            {path}
          </span>
          {file && (
            <span>
              <Delta added={file.added} removed={file.removed} />
            </span>
          )}
          {file && <FileIcon status={STATUS[file.status]} />}
          <button className="lm-icon-btn" title="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        {!state ? (
          <div className="lm-empty">Loading…</div>
        ) : !state.ok ? (
          <div className="lm-empty">{state.error}</div>
        ) : file ? (
          <DiffCode file={file} />
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
      </div>
    </div>
  )
}
