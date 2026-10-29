import { execFile } from 'node:child_process'
import path from 'node:path'
import { branchBase } from './base.js'
import { parse, type Mode, type State } from './diff.js'
import { addedLines, readRegular } from './files.js'

/**
 * A checkout's changes for the switcher, read-only: uncommitted (working tree
 * vs HEAD) or the whole branch (working tree vs its merge-base with the default
 * branch), untracked files included.
 */

/** Diff text past this is cut off (the panel isn't a code review tool). */
const MAX_BYTES = 2_000_000
const MAX_UNTRACKED = 200
/** `git hash-object -t tree /dev/null`: diff base for a repo without commits. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

class GitError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly stdout: string,
  ) {
    super(message)
  }
}

/** Output past MAX_BYTES is cut off rather than failing: callers see `length > MAX_BYTES` and mark the result truncated. */
function git(dir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      { cwd: dir, maxBuffer: MAX_BYTES + 1, timeout: 30_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
      (err, stdout, stderr) => {
        if (!err || (err as { code?: unknown }).code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve(stdout)
        const code = typeof err.code === 'number' ? err.code : null
        reject(new GitError(stderr.trim() || err.message, code, stdout))
      },
    )
  })
}

const tryGit = (dir: string, args: string[]) => git(dir, args).then((s) => s.trim(), () => '')

async function base(dir: string, mode: Mode, configured?: unknown): Promise<{ ref: string; label: string }> {
  const head = await tryGit(dir, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  if (!head) return { ref: EMPTY_TREE, label: 'empty repo' }
  const branch = mode === 'branch' && (await branchBase(dir, configured))
  return branch ? { ref: branch.sha, label: branch.ref } : { ref: 'HEAD', label: 'HEAD' }
}

/** `git diff --no-index` exits 1 when the files differ. A file gone (or unreadable) meanwhile is skipped. */
async function untrackedDiff(dir: string, file: string): Promise<string> {
  try {
    return await git(dir, ['diff', '--no-color', '--no-ext-diff', '--no-index', '--', '/dev/null', file])
  } catch (e) {
    return e instanceof GitError && e.code === 1 ? e.stdout : ''
  }
}

export async function changes(dir: string, mode: Mode, configured?: unknown): Promise<State> {
  if ((await tryGit(dir, ['rev-parse', '--is-inside-work-tree'])) !== 'true') return { ok: false, error: 'Not a git repository' }
  try {
    const against = await base(dir, mode, configured)
    let text = await git(dir, ['diff', '--no-color', '--no-ext-diff', '-M', against.ref, '--'])
    // From the repo root, like git diff's paths: a project in a subfolder would otherwise list its untracked files relative to itself.
    const top = (await tryGit(dir, ['rev-parse', '--show-toplevel'])) || dir
    const listing = await git(top, ['ls-files', '--others', '--exclude-standard', '-z'])
    // A cut-off listing ends in a partial name: drop it.
    const untracked = listing.split('\0').slice(0, listing.length > MAX_BYTES ? -1 : undefined).filter(Boolean)
    for (const file of untracked.slice(0, MAX_UNTRACKED)) {
      if (text.length > MAX_BYTES) break
      text += await untrackedDiff(top, file)
    }
    const truncated = text.length > MAX_BYTES || untracked.length > MAX_UNTRACKED || listing.length > MAX_BYTES
    // Cut at a line boundary so the parser never sees half a line.
    if (text.length > MAX_BYTES) text = text.slice(0, text.lastIndexOf('\n', MAX_BYTES))
    return { ok: true, mode, base: against.label, files: parse(text), truncated }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export interface Stats {
  added: number
  removed: number
}

/** Untracked files bigger than this aren't counted (generated, or not text). */
const MAX_COUNTED = 1_000_000

/**
 * Lines changed on the branch, uncommitted and untracked files included: the
 * Branch tab's totals without reading the diff itself. For every row of the
 * switcher, so one `git diff --numstat` plus a read of each untracked file.
 */
export async function stats(dir: string, configured?: unknown): Promise<Stats | null> {
  try {
    const against = await base(dir, 'branch', configured)
    const [numstat, listing] = await Promise.all([
      git(dir, ['diff', '--numstat', '--no-renames', against.ref, '--']),
      git(dir, ['ls-files', '--others', '--exclude-standard', '-z']),
    ])
    const out = { added: 0, removed: 0 }
    for (const line of numstat.split('\n')) {
      const [a, r] = line.split('\t')
      // Binary files are "-\t-".
      if (r !== undefined) (out.added += Number(a) || 0), (out.removed += Number(r) || 0)
    }
    for (const file of listing.split('\0').filter(Boolean).slice(0, MAX_UNTRACKED)) {
      const text = readRegular(path.join(dir, file), MAX_COUNTED)
      if (text && !text.subarray(0, 8000).includes(0)) out.added += addedLines(text.toString('utf8')) // NUL: binary
    }
    return out
  } catch {
    return null
  }
}
