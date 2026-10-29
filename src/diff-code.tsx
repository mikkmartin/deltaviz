import { useMemo } from 'react'
import type { DiffFile } from './diff.js'
import { HIGHLIGHT_CSS, highlightHunk, highlightText, languageOf } from './highlight.js'
import { alpha, blue, gray, green, red } from './palette.js'

/** Delta's colours, for any view that shows one */
export const DELTA_CSS = `.wtc-add { color: ${green[500]}; } .wtc-del { color: ${red[500]}; }`

/** A text diff's look, shared by the Files tab and the Map/Tree's diff modal */
export const DIFF_CSS = `
.wtc-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.wtc-file { border: 1px solid ${gray[700]}; border-radius: 6px; margin: 0 0 8px; overflow: hidden; }
.wtc-file > summary { cursor: pointer; display: flex; gap: 6px; align-items: baseline; padding: 4px 8px;
  background: ${gray[900]}; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.wtc-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
${DELTA_CSS}
.wtc-code { overflow-x: auto; font: 11.5px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
.wtc-code > div { white-space: pre; padding: 0 8px; min-width: max-content; }
.wtc-l-plus { background: ${alpha(green[600], 0.18)}; }
.wtc-l-minus { background: ${alpha(red[500], 0.18)}; }
.wtc-l-hunk { color: ${gray[400]}; background: ${alpha(blue[500], 0.1)}; }
.wtc-l-note { color: ${gray[400]}; }
.wtc-ln { display: inline-block; min-width: 4ch; margin-right: 12px; text-align: right; color: ${gray[500]}; user-select: none; }
${HIGHLIGHT_CSS}`

const LINE_CLASS = { '+': 'wtc-l-plus', '-': 'wtc-l-minus', ' ': '', '\\': 'wtc-l-note' }

/** `+12 −3`, each side only when nonzero; `format` for big totals (1.2k) */
export function Delta({ added, removed, format = String }: { added: number; removed: number; format?: (n: number) => string }) {
  return (
    <>
      {added > 0 && <span className="wtc-add">+{format(added)}</span>}
      {added > 0 && removed > 0 && ' '}
      {removed > 0 && <span className="wtc-del">−{format(removed)}</span>}
    </>
  )
}

/** One file's hunks, line by line, syntax-highlighted when its language is known */
export function DiffCode({ file }: { file: DiffFile }) {
  const html = useMemo(() => {
    const language = languageOf(file.path)
    return language ? file.hunks.map((h) => highlightHunk(h, language)) : []
  }, [file])
  return (
    <div className="wtc-code">
      {file.binary && <div className="wtc-l-note">Binary file</div>}
      {!file.binary && !file.hunks.length && <div className="wtc-l-note">No content changes</div>}
      {file.hunks.map((h, hi) => (
        <div key={hi} style={{ padding: 0 }}>
          <div className="wtc-l-hunk">{h.header}</div>
          {h.lines.map((l, li) => (
            <div key={li} className={LINE_CLASS[l.kind]}>
              {l.kind === '\\' ? (
                `\\${l.text}`
              ) : html[hi] ? (
                <>
                  {l.kind}
                  <span dangerouslySetInnerHTML={{ __html: html[hi]![li] }} />
                </>
              ) : (
                `${l.kind}${l.text}`
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/** A whole file, numbered and syntax-highlighted when its language is known */
export function FileCode({ path, text }: { path: string; text: string }) {
  const { lines, html } = useMemo(() => {
    const lines = text.replace(/\n$/, '').split('\n')
    const language = languageOf(path)
    const html = language ? highlightText(lines.join('\n'), language) : null
    return { lines, html: html?.length === lines.length ? html : null }
  }, [path, text])
  return (
    <div className="wtc-code">
      {lines.map((l, i) => (
        <div key={i}>
          <span className="wtc-ln">{i + 1}</span>
          {html ? <span dangerouslySetInnerHTML={{ __html: html[i]! }} /> : l}
        </div>
      ))}
    </div>
  )
}
