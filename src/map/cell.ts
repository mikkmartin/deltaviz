/** What the Tree's cells are: a file's fate on this branch, and room for labels. */
import type { HierarchyRectangularNode } from 'd3-hierarchy'
import type { TreeNode } from './tree.js'

export type R = HierarchyRectangularNode<TreeNode>
/** What the area of a cell stands for */
export type Area = 'lines' | 'files' | 'bytes'

/** A labelled folder's name row */
export const HEADER = 20

export const folderOf = (id: string) => id.slice(0, Math.max(0, id.lastIndexOf('/')))
export const baseName = (id: string) => id.slice(id.lastIndexOf('/') + 1)

/**
 * A file's fate. A move to another folder shows both spots (`movedAway` the old one,
 * `movedHere` the new) and an arrow between them; a rename in place is just its new name,
 * labelled `old → new` (its old spot isn't drawn).
 */
export type Fate = 'folder' | 'same' | 'added' | 'deleted' | 'edited' | 'renamed' | 'movedHere' | 'movedAway'

const moved = (from: string | undefined, to: string, inPlace: boolean) => !!from && (folderOf(from) === folderOf(to)) === inPlace
export const renamedAway = (t: TreeNode) => moved(t.file?.to, t.id, true)
export const renamedHere = (t: TreeNode) => moved(t.file?.from, t.id, true)

export function fateOf(t: TreeNode): Fate {
  const f = t.file
  if (!f) return 'folder'
  if (moved(f.to, t.id, false)) return 'movedAway'
  if (f.status === 'removed') return 'deleted'
  if (moved(f.from, t.id, false)) return 'movedHere'
  if (edited(t)) return 'edited'
  if (moved(f.from, t.id, true)) return 'renamed'
  return f.status === 'added' ? 'added' : 'same'
}

/**
 * Lines changed in place, drawn with their change line and `+a−d`: a modified file, or a
 * moved or renamed one whose content changed too.
 */
export function edited(t: TreeNode): boolean {
  const f = t.file
  if (!f) return false
  return f.status === 'modified' || (!!f.from && (t.added > 0 || t.deleted > 0))
}

/** Room for a file's name at the top of its cell */
export const hasTitle = (c: R) => c.x1 - c.x0 > 40 && c.y1 - c.y0 > 14
/** A folder big enough for a name row (the zoomed-in one is the canvas: none) */
export const hasHeader = (c: R) => c.depth > 0 && c.x1 - c.x0 > 60 && c.y1 - c.y0 > 30
