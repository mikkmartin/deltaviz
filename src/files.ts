import fs from 'node:fs'

/**
 * A regular file's contents, or null: symlinks, pipes, devices and files over
 * `max` bytes are never read (a link to a FIFO or /dev/zero would hang or
 * exhaust the daemon). Repos are untrusted input.
 */
export function readRegular(file: string, max: number): Buffer | null {
  try {
    const st = fs.lstatSync(file)
    return st.isFile() && st.size <= max ? fs.readFileSync(file) : null
  } catch {
    return null // gone meanwhile
  }
}
