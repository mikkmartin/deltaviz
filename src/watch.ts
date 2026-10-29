import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Calls `onChange` once things settle (DEBOUNCE_MS without an event) after
 * anything in the worktree that git doesn't ignore changes, or the git state
 * does: HEAD, the index, refs. Runs one `onChange` at a time; events during one
 * call it once more after.
 */

const DEBOUNCE_MS = 300

const git = (cwd: string, args: string[], input?: string) =>
  new Promise<string>((resolve) => {
    const p = execFile('git', args, { cwd }, (err, stdout) => resolve(err && !stdout ? '' : stdout))
    if (input !== undefined) p.stdin?.end(input)
  })

/** Inside a git dir, what moves the state: not objects, logs, lock files or other worktrees' dirs */
const gitStateFile = (rel: string) => !/^(objects|logs|hooks|info|lfs|rr-cache|worktrees)(\/|$)/.test(rel) && !rel.endsWith('.lock') && !/fsmonitor|COMMIT_EDITMSG/.test(rel)

export async function watch(root: string, onChange: () => Promise<void>) {
  const abs = (p: string) => path.resolve(root, p.trim())
  const gitDir = abs(await git(root, ['rev-parse', '--git-dir']))
  const commonDir = abs(await git(root, ['rev-parse', '--git-common-dir']))
  const gitDirs = [...new Set([gitDir, commonDir])]

  /** Worktree paths (repo-relative) seen since the last check */
  let pending = new Set<string>()
  let gitChanged = false
  let timer: NodeJS.Timeout | undefined
  let running = false
  let again = false

  const run = async () => {
    if (running) return void (again = true)
    const paths = [...pending]
    const wasGit = gitChanged
    pending = new Set()
    gitChanged = false
    // Only worth a re-read if git sees one of them (node_modules, dist, … don't count).
    const ignored = paths.length ? new Set((await git(root, ['check-ignore', '-z', '--stdin'], paths.join('\0') + '\0')).split('\0')) : new Set()
    if (!wasGit && paths.every((p) => ignored.has(p))) return
    running = true
    try {
      await onChange()
    } catch (e) {
      console.error(`deltaviz: ${(e as Error).message}`)
    } finally {
      running = false
      if (again) (again = false), schedule()
    }
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(run, DEBOUNCE_MS)
  }

  const onEvent = (dir: string) => (_: string, file: string | null) => {
    if (!file) return void ((gitChanged = true), schedule())
    const full = path.join(dir, file)
    const inGit = gitDirs.find((g) => full === g || full.startsWith(g + path.sep))
    if (inGit) {
      if (!gitStateFile(path.relative(inGit, full).split(path.sep).join('/'))) return
      gitChanged = true
    } else {
      const rel = path.relative(root, full).split(path.sep).join('/')
      if (rel.startsWith('..') || /(^|\/)node_modules(\/|$)/.test(rel)) return
      pending.add(rel)
    }
    schedule()
  }

  fs.watch(root, { recursive: true }, onEvent(root))
  // A linked worktree's git dirs live outside it.
  for (const g of gitDirs) if (!g.startsWith(root + path.sep)) fs.watch(g, { recursive: true }, onEvent(g))
}
