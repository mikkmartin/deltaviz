import { execFile } from 'node:child_process'

/**
 * Where a checkout's branch left the default branch: one answer for the
 * Files diff, the Map and Tree graph and the row stats, so they always agree.
 */

const tryGit = (dir: string, args: string[]) =>
  new Promise<string>((resolve) =>
    execFile('git', args, { cwd: dir, timeout: 10_000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, stdout) =>
      resolve(err ? '' : stdout.trim()),
    ),
  )

/** `options.base` if it resolves, else origin's default branch, else a local main/master. */
export async function defaultBranch(dir: string, configured?: unknown): Promise<string | null> {
  const candidates = typeof configured === 'string' && configured ? [configured] : []
  candidates.push(await tryGit(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']), 'origin/main', 'origin/master', 'main', 'master')
  for (const ref of candidates.filter(Boolean)) {
    if (await tryGit(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) return ref
  }
  return null
}

/** The default branch and HEAD's merge-base with it; null without commits or a default branch. */
export async function branchBase(dir: string, configured?: unknown): Promise<{ ref: string; sha: string } | null> {
  const ref = await defaultBranch(dir, configured)
  const sha = ref && (await tryGit(dir, ['merge-base', 'HEAD', ref]))
  return ref && sha ? { ref, sha } : null
}
