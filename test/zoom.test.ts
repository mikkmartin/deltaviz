import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advance, camera, full, lookAt, mapBox, opacity, place, rebase, retarget, still, then, type Box, type Spring } from '../src/map/zoom.ts'

const W = 800
const H = 500
const cell = { x0: 100, y0: 50, x1: 300, y1: 175 }
const near = (a: Box, b: Box, eps = 1e-6) => (['x0', 'y0', 'x1', 'y1'] as const).every((k) => Math.abs(a[k] - b[k]) < eps)
const logArea = (b: Box) => Math.log((b.x1 - b.x0) * (b.y1 - b.y0))
const run = (s: Spring, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 60) if (advance(s, 1 / 60)) return true
  return false
}

test('the camera at a cell shows a view placed there as the whole screen', () => {
  const m = then(place(cell, W, H), lookAt(cell, W, H))
  for (const [k, v] of Object.entries({ sx: 1, sy: 1, tx: 0, ty: 0 })) assert.ok(Math.abs(m[k as keyof typeof m] - v) < 1e-9)
})

test('zooming in comes to rest exactly on the cell', () => {
  const s = still(full(W, H))
  retarget(s, cell)
  assert.ok(run(s, 3))
  assert.deepEqual(camera(s), cell)
})

test('zooming in and out mirror each other: the zoom gets as far, as fast', () => {
  const [zin, zout] = [still(full(W, H)), still(cell)]
  retarget(zin, cell)
  retarget(zout, full(W, H))
  const [a, b] = [logArea(full(W, H)), logArea(cell)]
  for (let i = 0; i < 40; i++) {
    advance(zin, 1 / 60)
    advance(zout, 1 / 60)
    const fin = (logArea(camera(zin)) - a) / (b - a)
    const fout = (logArea(camera(zout)) - b) / (a - b)
    assert.ok(Math.abs(fin - fout) < 1e-9)
  }
})

test('the point both boxes share stays put on screen while zooming', () => {
  const s = still(full(W, H))
  retarget(s, cell)
  // Where the cell's spot maps to in both: x = 800·(x-100)/200 → fixed at x = 400/3.
  const fixed = 100 / (1 - 200 / 800)
  for (let i = 0; i < 20; i++) {
    advance(s, 1 / 60)
    const c = camera(s)
    assert.ok(Math.abs(((fixed - c.x0) / (c.x1 - c.x0)) * W - fixed) < 1e-6)
  }
})

test('retargeted mid-flight, it carries on from where it is, zooming as fast', () => {
  const s = still(full(W, H))
  retarget(s, cell)
  for (let i = 0; i < 6; i++) advance(s, 1 / 60)
  const here = camera(s)
  const rate = s.v * (logArea(s.to) - logArea(s.from))
  retarget(s, full(W, H))
  assert.ok(near(camera(s), here))
  assert.ok(Math.abs(s.v * (logArea(s.to) - logArea(s.from)) - rate) < 1e-9)
  assert.ok(run(s, 3))
  assert.deepEqual(camera(s), full(W, H))
})

test('the new view fades in mid-flight: hidden at the start, opaque at the end', () => {
  const whole = full(W, H)
  assert.equal(opacity(whole, cell, whole), 0)
  assert.equal(opacity(cell, cell, whole), 1)
  assert.equal(opacity(whole, whole, null), 1)
})

test('rebasing moves the camera with the views, so nothing on screen jumps', () => {
  const s = still(full(W, H))
  retarget(s, cell)
  advance(s, 0.05)
  const outer = { x0: 400, y0: 250, x1: 600, y1: 375 }
  const a = place(outer, W, H)
  const before = then(place(cell, W, H), lookAt(camera(s), W, H))
  rebase(s, a)
  const after = then(place(mapBox(a, cell), W, H), lookAt(camera(s), W, H))
  for (const k of ['sx', 'sy', 'tx', 'ty'] as const) assert.ok(Math.abs(before[k] - after[k]) < 1e-6)
})
