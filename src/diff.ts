/** Unified diff (`git diff` output) → files and hunks for the panel. */

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed'

export interface DiffLine {
  kind: '+' | '-' | ' ' | '\\'
  text: string
}

export interface Hunk {
  header: string
  lines: DiffLine[]
}

export interface DiffFile {
  path: string
  /** Previous path, for renames */
  from?: string
  status: FileStatus
  binary: boolean
  added: number
  removed: number
  hunks: Hunk[]
}

export type Mode = 'uncommitted' | 'branch'

export type State =
  | { ok: true; mode: Mode; base: string; files: DiffFile[]; truncated: boolean }
  | { ok: false; error: string }

/** Git quotes paths with special characters, and ends `---`/`+++` paths containing spaces with a tab. */
function unquote(p: string): string {
  p = p.replace(/\t$/, '')
  if (!p.startsWith('"') || !p.endsWith('"')) return p
  try {
    return JSON.parse(p) as string
  } catch {
    return p.slice(1, -1) // octal escapes (control characters): show them as-is
  }
}

/** `a/x` / `b/x` → `x` */
const stripPrefix = (p: string) => unquote(p).replace(/^[ab]\//, '')

export function parse(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: Hunk | null = null
  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      // Fallback name; `---`/`+++`/rename lines below are more precise.
      const m = /^diff --git (?:"?a\/)(.*?)"? (?:"?b\/)(.*?)"?$/.exec(raw)
      file = { path: m ? m[2] : raw.slice(11), status: 'modified', binary: false, added: 0, removed: 0, hunks: [] }
      hunk = null
      files.push(file)
      continue
    }
    if (!file) continue
    if (hunk) {
      const kind = raw[0]
      if (kind === '+' || kind === '-' || kind === ' ' || kind === '\\') {
        hunk.lines.push({ kind, text: raw.slice(1) })
        if (kind === '+') file.added++
        if (kind === '-') file.removed++
        continue
      }
      if (!raw.startsWith('@@')) continue // blank trailing line
    }
    if (raw.startsWith('@@')) {
      hunk = { header: raw, lines: [] }
      file.hunks.push(hunk)
    } else if (raw.startsWith('new file mode')) file.status = 'added'
    else if (raw.startsWith('deleted file mode')) file.status = 'deleted'
    else if (raw.startsWith('rename from ')) {
      file.status = 'renamed'
      file.from = unquote(raw.slice(12))
    } else if (raw.startsWith('rename to ')) file.path = unquote(raw.slice(10))
    else if (raw.startsWith('Binary files ')) file.binary = true
    else if (raw.startsWith('+++ ') && raw !== '+++ /dev/null') file.path = stripPrefix(raw.slice(4))
    else if (raw.startsWith('--- ') && raw !== '--- /dev/null' && file.status === 'deleted') file.path = stripPrefix(raw.slice(4))
  }
  return files
}
