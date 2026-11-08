import { useLayoutEffect, useMemo, useRef } from 'react'
import type { DiffFile, DiffLine, Hunk } from './diff.js'
import { HIGHLIGHT_CSS, highlightHunk, highlightText, languageOf } from './highlight.js'
import { alpha, gray, green, MONO, red, white } from './palette.js'

/** Delta's colours, for any view that shows one */
export const DELTA_CSS = `.wtc-add { color: ${green[500]}; } .wtc-del { color: ${red[500]}; }`

/** The line numbers' column: room for 5 digits and the gap after them */
const GUTTER = 64

/** A text diff's look, shared by the Files tab and the Map/Tree's diff modal */
export const DIFF_CSS = `
.wtc-bar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.wtc-file { border: 1px solid ${gray[700]}; border-radius: 6px; margin: 0 0 8px; overflow: hidden; }
.wtc-file > summary { cursor: pointer; display: flex; gap: 6px; align-items: baseline; padding: 4px 8px;
  background: ${gray[900]}; font: 12px ${MONO}; }
.wtc-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
${DELTA_CSS}
.wtc-code { overflow-x: auto; padding: 8px 0 24px; font: 12.5px/20px ${MONO}; word-spacing: normal; tab-size: 2; color: #e1e3ea; }
/* A line, as an editor draws it (Cursor's): its number in a dim gutter, a change only as a soft tint and a bar at the gutter's edge. */
.cl { display: flex; min-width: max-content; }
.cl:hover { background: ${alpha(white, 0.03)}; }
.cl:hover .cl-n { color: ${gray[400]}; }
.cl-n { flex: none; position: sticky; left: 0; width: ${GUTTER}px; padding-right: 16px; box-sizing: border-box; text-align: right; color: ${gray[600]}; background: ${gray[950]}; user-select: none; }
.cl-t { white-space: pre; padding-right: 24px; }
.cl.plus { background: ${alpha(green[500], 0.14)}; }
.cl.minus { background: ${alpha(red[500], 0.14)}; }
.cl.plus .cl-n { box-shadow: inset 2px 0 ${green[500]}; background: color-mix(in srgb, ${gray[950]}, ${green[500]} 14%); }
.cl.minus .cl-n { box-shadow: inset 2px 0 ${red[500]}; background: color-mix(in srgb, ${gray[950]}, ${red[500]} 14%); }
/* A changed line's number in its colour (a removed one shows where it was) */
.cl.plus .cl-n, .cl.plus:hover .cl-n { color: ${green[400]}; }
.cl.minus .cl-n, .cl.minus:hover .cl-n { color: ${red[400]}; }
.cl.note, .cl.hunk { color: ${gray[500]}; }
.cl.hunk { margin: 8px 0 4px; }
.cl.hunk .cl-n { color: ${gray[600]}; }
${HIGHLIGHT_CSS}`

const LINE_CLASS = { '+': 'cl plus', '-': 'cl minus', ' ': 'cl', '\\': 'cl note' }

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

/** Each line's number in the old and new file (null on the side it isn't on), from the hunk header `@@ -a,b +c,d @@` */
function lineNumbers(h: Hunk): [number | null, number | null][] {
  const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(h.header)
  let old = m ? Number(m[1]) : 0
  let now = m ? Number(m[2]) : 0
  return h.lines.map((l) =>
    l.kind === ' ' ? [m ? old++ : null, m ? now++ : null] : l.kind === '-' ? [m ? old++ : null, null] : l.kind === '+' ? [null, m ? now++ : null] : [null, null],
  )
}

/** One file's hunks, line by line, numbered and syntax-highlighted when its language is known, as an editor shows a diff */
export function DiffCode({ file, whole }: { file: DiffFile; whole?: boolean }) {
  const html = useMemo(() => {
    const language = languageOf(file.path)
    return language ? file.hunks.map((h) => highlightHunk(h, language)) : []
  }, [file])
  const numbers = useMemo(() => file.hunks.map(lineNumbers), [file])
  // The whole file opens at its first change, in the middle of the view.
  const firstChange = whole ? file.hunks[0]!.lines.findIndex((l) => l.kind === '+' || l.kind === '-') : -1
  const first = useRef<HTMLDivElement>(null)
  // Braced: scrollIntoView returns a Promise in current browsers, and an effect may only return its cleanup.
  useLayoutEffect(() => {
    first.current?.scrollIntoView({ block: 'center' })
  }, [])
  return (
    <div className="wtc-code">
      {file.binary && <div className="cl note"><span className="cl-n" /><span className="cl-t">Binary file</span></div>}
      {!file.binary && !file.hunks.length && <div className="cl note"><span className="cl-n" /><span className="cl-t">No content changes</span></div>}
      {file.hunks.map((h, hi) => (
        <div key={hi}>
          {/* Hunks alone: where each starts, quietly (the whole file needs none) */}
          {!whole && (
            <div className="cl hunk">
              <span className="cl-n">⋯</span>
              <span className="cl-t">{h.header.replace(/^@@[^@]*@@\s*/, '') || ' '}</span>
            </div>
          )}
          {h.lines.map((l, li) => (
            <div key={li} className={LINE_CLASS[l.kind]} ref={hi === 0 && li === firstChange ? first : undefined}>
              {/* The line's number now; a removed line, the one it had */}
              <span className="cl-n">{l.kind === '-' ? numbers[hi]![li]![0] : numbers[hi]![li]![1]}</span>
              {l.kind === '\\' ? (
                <span className="cl-t">{`\\${l.text}`}</span>
              ) : html[hi] ? (
                <span className="cl-t" dangerouslySetInnerHTML={{ __html: html[hi]![li] || ' ' }} />
              ) : (
                <span className="cl-t">{l.text || ' '}</span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * The file's diff as the whole file: `text` (the file now) with the hunks in place and the
 * unchanged lines between them as context, one hunk numbered from line 1. Null when `text`
 * isn't what the diff's new side says (it changed since), or there's nothing to merge.
 */
export function wholeFile(file: DiffFile, text: string): DiffFile | null {
  if (file.binary || !file.hunks.length || file.status === 'deleted') return null
  const now = text.replace(/\n$/, '').split('\n')
  const lines: DiffLine[] = []
  let at = 0
  for (const h of file.hunks) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))?/.exec(h.header)
    if (!m) return null
    // A hunk adding to an empty side starts at line 0: the lines it holds start after it.
    const start = Math.max(0, Number(m[1]) - (m[2] === '0' ? 0 : 1))
    if (start < at) return null
    for (; at < start; at++) lines.push({ kind: ' ', text: now[at]! })
    for (const l of h.lines) {
      if (l.kind === ' ' || l.kind === '+') {
        if (now[at] !== l.text) return null
        at++
      }
      lines.push(l)
    }
  }
  if (at > now.length) return null
  for (; at < now.length; at++) lines.push({ kind: ' ', text: now[at]! })
  return { ...file, hunks: [{ header: '@@ -1 +1 @@', lines }] }
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
        <div key={i} className="cl">
          <span className="cl-n">{i + 1}</span>
          {html ? <span className="cl-t" dangerouslySetInnerHTML={{ __html: html[i] || ' ' }} /> : <span className="cl-t">{l || ' '}</span>}
        </div>
      ))}
    </div>
  )
}
