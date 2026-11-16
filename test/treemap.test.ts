import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GraphNode } from '../src/map/model.ts'
import { buildTree } from '../src/map/tree.ts'
import { createTreemap, type Layout } from '../src/map/treemap.ts'

const file = (id: string, lines: number, extra: Partial<GraphNode> = {}): GraphNode =>
  ({ id, cluster: '', status: 'same', added: 0, deleted: 0, lines, baseLines: lines, bytes: lines * 30, baseBytes: lines * 30, ...extra }) as GraphNode

/** A repo where `src` is a narrow box at the top: laid out afresh on a wide canvas, its rows differ */
function tree(sizes: Record<string, number>) {
  return buildTree({ nodes: Object.entries(sizes).map(([id, n]) => file(id, n)), edges: [] })
}
const SIZES = { 'src/a.ts': 400, 'src/b.ts': 300, 'src/c.ts': 200, 'src/d.ts': 120, 'src/e.ts': 80, 'src/f.ts': 50, 'lib/x.ts': 3000, 'lib/y.ts': 1000 }

/** Where each of `folder`'s children sits in its box, in tenths (coarse: the name row shifts things a little) */
function arrangement(view: Layout, folder: string) {
  const f = view.cells.get(folder)!
  const [w, h] = [f.x1 - f.x0, f.y1 - f.y0]
  return new Map((f.children ?? []).map((c) => [c.data.id, [((c.x0 - f.x0) / w) * 10, ((c.y0 - f.y0) / h) * 10]]))
}
/** The same arrangement, give or take a tenth */
function same(a: Map<string, number[]>, b: Map<string, number[]>) {
  return a.size === b.size && [...a].every(([id, p]) => b.has(id) && p.every((v, i) => Math.abs(v - b.get(id)![i]) <= 1))
}

test('every cell fits the canvas; the top is it, unpadded and square-cornered', () => {
  const { root } = tree(SIZES)
  const view = createTreemap().layout(root, 800, 500)
  assert.equal(view.top, root)
  assert.deepEqual([view.laid.x0, view.laid.y0, view.laid.x1, view.laid.y1], [0, 0, 800, 500])
  assert.equal(view.radius.get(''), 0)
  for (const c of view.cells.values()) assert.ok(c.x0 >= 0 && c.y0 >= 0 && c.x1 <= 800 && c.y1 <= 500, c.data.id)
})

test('a folder zoomed into keeps the arrangement it had in the view above, and back out', () => {
  const { root, byId } = tree(SIZES)
  const map = createTreemap()
  const above = arrangement(map.layout(root, 800, 500), 'src')
  const zoomed = arrangement(map.layout(byId.get('src')!, 800, 500), 'src')
  assert.ok(same(zoomed, above))
  // Not what it'd be laid out afresh (else this test proves nothing).
  assert.ok(!same(arrangement(createTreemap().layout(byId.get('src')!, 800, 500), 'src'), above))
  assert.ok(same(arrangement(map.layout(root, 800, 500), 'src'), above))
})

test('zooming out to a folder first seen zoomed in keeps that arrangement', () => {
  const { root, byId } = tree(SIZES)
  const map = createTreemap()
  const zoomed = arrangement(map.layout(byId.get('src')!, 800, 500), 'src')
  assert.ok(same(arrangement(map.layout(root, 800, 500), 'src'), zoomed))
})

test('a slightly different size (the bar changing height on zoom) keeps the arrangement', () => {
  const { root, byId } = tree(SIZES)
  const map = createTreemap()
  const above = arrangement(map.layout(root, 800, 500), 'src')
  assert.ok(same(arrangement(map.layout(byId.get('src')!, 800, 470), 'src'), above))
})

test('a much different shape lays out afresh, as a fresh treemap would', () => {
  const { root, byId } = tree(SIZES)
  const map = createTreemap()
  map.layout(root, 800, 500)
  const zoomed = arrangement(map.layout(byId.get('src')!, 500, 800), 'src')
  assert.ok(same(zoomed, arrangement(createTreemap().layout(byId.get('src')!, 500, 800), 'src')))
})

test('a folder that was a sliver above is laid out afresh zoomed into, not stretched', () => {
  const { root, byId } = tree({ ...SIZES, 'lib/x.ts': 60000 })
  const map = createTreemap()
  map.layout(root, 800, 500)
  const zoomed = arrangement(map.layout(byId.get('src')!, 800, 500), 'src')
  assert.ok(same(zoomed, arrangement(createTreemap().layout(byId.get('src')!, 800, 500), 'src')))
})

test('cellOf: a file too small (or filtered out) is drawn in its nearest accepted ancestor', () => {
  const { root, byId } = tree(SIZES)
  const view = createTreemap().layout(root, 800, 500)
  const f = byId.get('src/f.ts')!
  assert.equal(view.cellOf(f)?.data.id, 'src/f.ts')
  assert.equal(view.cellOf(f, (c) => !c.data.file)?.data.id, 'src')
  assert.equal(view.cellOf(f, (c) => c.depth === 0)?.data.id, '')
  assert.equal(view.cellOf(null), undefined)
  // Outside the view: nothing.
  const zoomed = createTreemap().layout(byId.get('src')!, 800, 500)
  assert.equal(zoomed.cellOf(byId.get('lib/x.ts')), undefined)
})

test('a deleted file keeps the area it had; a renamed-away spot is not drawn', () => {
  const nodes = [file('a.ts', 100), file('b.ts', 100, { status: 'removed', lines: 0, baseLines: 100 }), file('c.ts', 100, { from: 'old.ts' }), file('old.ts', 100, { to: 'c.ts' })]
  const { root } = buildTree({ nodes, edges: [] })
  const view = createTreemap().layout(root, 600, 200)
  const w = (id: string) => { const c = view.cells.get(id)!; return Math.round((c.x1 - c.x0) * (c.y1 - c.y0)) }
  assert.ok(Math.abs(w('a.ts') - w('b.ts')) / w('a.ts') < 0.05)
  assert.equal(view.cells.has('old.ts'), false)
})

test('deepest counts folder depth in view', () => {
  const { root } = tree({ 'a/b/c/x.ts': 10, 'a/b/y.ts': 10, 'z.ts': 10 })
  // a and a/b merge: a/b at 1, a/b/c at 2.
  assert.equal(createTreemap().layout(root, 400, 400).deepest, 2)
})
