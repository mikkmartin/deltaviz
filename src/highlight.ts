import { highlight, type LanguageName } from 'sugar-high'
import { lang } from 'sugar-high/lang'
import type { Hunk } from './diff.js'

/**
 * Token colours, deltaviz's own ("nocturne"): a cool base (cornflower keywords, seafoam strings,
 * orchid calls, misty properties) with one warm accent (apricot types and numbers); no pure green
 * or red, so the code never competes with the diff's. For the `--sh-*` variables sugar-high's spans use.
 */
export const HIGHLIGHT_CSS = `
.wtc-code { --sh-keyword: #9db1ff; --sh-string: #8fd3c8; --sh-class: #f4b98a; --sh-entity: #e2c2f5; --sh-property: #c3cbe0;
  --sh-identifier: #e1e3ea; --sh-jsxliterals: #e1e3ea; --sh-sign: #868a99; --sh-comment: #5f6371; }
.wtc-code .sh__token--comment { font-style: italic; }
`

/** The file's language from its extension (or name: Dockerfile); null when sugar-high has none */
export function languageOf(path: string): LanguageName | null {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  // .mts/.cts and .mjs/.cjs aren't in sugar-high's table.
  const ext = dot > 0 ? name.slice(dot).replace(/^\.[mc]([jt]s)$/, '.$1') : name
  const l = lang(ext) as LanguageName | undefined
  return l && l !== 'plaintext' ? l : null
}

/**
 * A hunk's lines as HTML, or null when it can't be highlighted. The old and new
 * sides are highlighted as runs of code (so a JSDoc block stays a comment past
 * its first line) and each line takes its side's tokens.
 */
export function highlightHunk(hunk: Hunk, language: LanguageName): string[] | null {
  const side = (keep: string) => {
    const lines = hunk.lines.filter((l) => l.kind === ' ' || l.kind === keep)
    // A new file has no old side (a deleted one, no new side); highlight('') would still be one line.
    if (!lines.length) return []
    const html = highlight(lines.map((l) => l.text).join('\n'), { lang: language }).split('\n')
    return html.length === lines.length ? html : null
  }
  const before = side('-')
  const after = side('+')
  if (!before || !after) return null
  let b = 0
  let a = 0
  return hunk.lines.map((l) => {
    if (l.kind === ' ') return (b++, after[a++])
    if (l.kind === '-') return before[b++]
    if (l.kind === '+') return after[a++]
    return ''
  })
}

/** A whole text's lines as HTML */
export function highlightText(text: string, language: LanguageName): string[] {
  return highlight(text, { lang: language }).split('\n')
}
