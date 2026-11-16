// A scripted stand-in for a coding agent: lands a believable "search the map" feature
// in `repo`, one save at a time, on a timeline. Deterministic so the demo can be re-recorded.
//
//   node agent.ts <repo> [--gap <ms>]
import fs from 'node:fs'
import path from 'node:path'

type Step =
  | { file: string; create: string }
  | { file: string; after: string; insert: string }
  | { file: string; replace: string; with: string }

const SEARCH = `import type { TreeNode } from './map/tree.js'

/**
 * The map's search: a query typed in the sidebar narrows the map to the files whose
 * path matches it (every word, in order, case-insensitive); folders stay lit while
 * anything inside them does.
 */

export interface Search {
  query: string
  /** Ids that match, folders included; null while there's no query */
  hits: Set<string> | null
}

export function matches(id: string, query: string): boolean {
  let at = 0
  const path = id.toLowerCase()
  for (const word of query.toLowerCase().split(/\\s+/).filter(Boolean)) {
    const i = path.indexOf(word, at)
    if (i < 0) return false
    at = i + word.length
  }
  return true
}

/** Everything under \`root\` that \`query\` matches */
export function search(root: TreeNode, query: string): Search {
  if (!query.trim()) return { query, hits: null }
  const hits = new Set<string>()
  const walk = (t: TreeNode): boolean => {
    const hit = t.file ? matches(t.id, query) : t.children.map(walk).some(Boolean)
    if (hit) hits.add(t.id)
    return hit
  }
  walk(root)
  return { query, hits }
}

export const SEARCH_CSS = \`
.search { all: unset; box-sizing: border-box; width: 100%; height: 28px; padding: 0 8px; border-radius: 6px; }
.search::placeholder { opacity: 0.5; }
\`
`

export const STEPS: Step[] = [
  { file: 'src/search.ts', create: SEARCH },
  {
    file: 'src/app.tsx',
    after: "import { useSize } from './map/useSize.js'",
    insert: "import { search as find, SEARCH_CSS } from './search.js'",
  },
  {
    file: 'src/app.tsx',
    replace: "  const tree = useMemo(() => treeData && buildTree(treeData), [treeData])",
    with: `  const tree = useMemo(() => treeData && buildTree(treeData), [treeData])
  // Narrowed by the sidebar's search: the map dims what doesn't match.
  const [query, setQuery] = useState('')
  const search = useMemo(() => tree && find(tree.root, query), [tree, query])`,
  },
  {
    file: 'src/map/MapView.tsx',
    after: "import { buildTree, exposedFiles, fmt, fmtBytes, startNode, type TreeNode } from './tree.js'",
    insert: "import type { Search } from '../search.js'",
  },
  {
    file: 'src/app.tsx',
    replace: '      <style>{CSS + SUMMARY_CSS + SIDEBAR_CSS + SHEET_CSS + TABS_CSS + SWITCH_CSS}</style>',
    with: '      <style>{CSS + SUMMARY_CSS + SIDEBAR_CSS + SHEET_CSS + TABS_CSS + SWITCH_CSS + SEARCH_CSS}</style>',
  },
  {
    file: 'src/map/Summary.tsx',
    after: "import { fmt } from './tree.js'",
    insert: "import { type Search } from '../search.js'",
  },
  {
    file: 'src/map/tree.ts',
    after: '  depth: number',
    insert: '  /** Whether the search matches it (or, for a folder, anything in it) */\n  match?: boolean',
  },
  {
    file: 'src/app.tsx',
    replace: '              flash={flash}',
    with: '              flash={flash}\n              hits={search?.hits}',
  },
]

if (import.meta.url === `file://${process.argv[1]}`) {
  const repo = process.argv[2]
  if (!repo) throw new Error('usage: node agent.ts <repo> [--gap <ms>]')
  const g = process.argv.indexOf('--gap')
  const gap = g > 0 ? Number(process.argv[g + 1]) : 600
  for (const s of STEPS) {
    apply(repo, s)
    console.log(`edit ${s.file}`)
    await new Promise((r) => setTimeout(r, gap))
  }
}

export function apply(repo: string, s: Step) {
  const file = path.join(repo, s.file)
  if ('create' in s) return fs.writeFileSync(file, s.create)
  const src = fs.readFileSync(file, 'utf8')
  const [from, to] = 'after' in s ? [s.after, `${s.after}\n${s.insert}`] : [s.replace, s.with]
  if (!src.includes(from)) throw new Error(`${s.file}: anchor not found: ${from}`)
  fs.writeFileSync(file, src.replace(from, to))
}
