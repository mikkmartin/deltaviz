import type { DiffFile } from '../diff.js'

/** A run of added or removed lines, in a file's unified view (its lines now, removed ones in place) */
export interface Run {
  kind: '+' | '-'
  start: number
  count: number
}

/**
 * Where a file's changes are: runs over the unified view of `length` lines now
 * plus the removed ones, as a diff shows them. `total` is that view's length.
 */
export function changeRuns(file: DiffFile, length: number): { runs: Run[]; total: number } {
  const runs: Run[] = []
  let at = 0 // position in the unified view
  let line = 1 // next line of the file now
  for (const hunk of file.hunks) {
    const start = Number(/\+(\d+)/.exec(hunk.header)?.[1] ?? line)
    // Unchanged lines between hunks (a hunk of a new file starts at 0).
    at += Math.max(0, start - line)
    line = Math.max(line, start)
    for (const l of hunk.lines) {
      if (l.kind === '\\') continue
      if (l.kind !== ' ') {
        const last = runs[runs.length - 1]
        if (last && last.kind === l.kind && last.start + last.count === at) last.count++
        else runs.push({ kind: l.kind, start: at, count: 1 })
      }
      at++
      if (l.kind !== '-') line++
    }
  }
  return { runs, total: at + Math.max(0, length - (line - 1)) }
}
