/**
 * Zooming as a camera on a spring. Every view in flight is placed somewhere in one space (the
 * base view's, W×H); the camera is the box of that space on screen. A new zoom mid-flight only
 * moves the spring's target: it carries on from where it is, at the speed it has.
 */

export type Box = { x0: number; y0: number; x1: number; y1: number }
/** Scale then shift, per axis: what a view's coordinates are somewhere else */
export type Affine = { sx: number; sy: number; tx: number; ty: number }

export const full = (W: number, H: number): Box => ({ x0: 0, y0: 0, x1: W, y1: H })
/** A whole view (W×H) shrunk into `b` */
export const place = (b: Box, W: number, H: number): Affine => ({ sx: (b.x1 - b.x0) / W, sy: (b.y1 - b.y0) / H, tx: b.x0, ty: b.y0 })
/** The camera at `b`: `b` blown up to the screen (W×H) */
export const lookAt = (b: Box, W: number, H: number): Affine => {
  const sx = W / (b.x1 - b.x0)
  const sy = H / (b.y1 - b.y0)
  return { sx, sy, tx: -b.x0 * sx, ty: -b.y0 * sy }
}
/** `b` after `a` */
export const then = (b: Affine, a: Affine): Affine => ({ sx: a.sx * b.sx, sy: a.sy * b.sy, tx: a.sx * b.tx + a.tx, ty: a.sy * b.ty + a.ty })
export const mapBox = (a: Affine, b: Box): Box => ({ x0: a.sx * b.x0 + a.tx, y0: a.sy * b.y0 + a.ty, x1: a.sx * b.x1 + a.tx, y1: a.sy * b.y1 + a.ty })
export const css = (a: Affine) => `matrix(${a.sx},0,0,${a.sy},${a.tx},${a.ty})`

/** How far into a zoom (in log area, 0 at `from`, 1 at `to`) the new view fades in: mid-flight, so the switch isn't seen */
const FADE = [0.4, 0.6] as const
const logArea = (b: Box) => Math.log(Math.max(1e-9, (b.x1 - b.x0) * (b.y1 - b.y0)))
/** A view at `box`, zoomed into from `parent`, as seen by the camera at `cam`: hidden out at `parent`, opaque close in */
export function opacity(cam: Box, box: Box, parent: Box | null): number {
  if (!parent) return 1
  const span = logArea(parent) - logArea(box)
  if (span <= 1e-6) return 1
  const f = (logArea(parent) - logArea(cam)) / span
  return Math.min(1, Math.max(0, (f - FADE[0]) / (FADE[1] - FADE[0])))
}

/**
 * The spring. Below 2·√STIFFNESS it bounces, the same way in and out: past the target zooming in,
 * the base view shrunk a little zooming out.
 */
const STIFFNESS = 600
const DAMPING = 1.8 * Math.sqrt(STIFFNESS)
const STEP = 1 / 240

/**
 * A leg of the camera's flight, `from` one box `to` another, `t` of the way (0 to 1, past it when
 * bouncing) at `v` per second. Sizes change by the same factor each step of `t`, about the point
 * both boxes share (where it stays on screen): zooming in and out mirror each other.
 */
export interface Spring {
  from: Box
  to: Box
  t: number
  v: number
}
export const still = (b: Box): Spring => ({ from: b, to: b, t: 1, v: 0 })

/** One axis of a leg at `t`: its start and size */
function axis(a0: number, aw: number, b0: number, bw: number, t: number): [number, number] {
  const w = aw * Math.pow(bw / aw, t)
  // Same size: a pan.
  if (Math.abs(bw - aw) < 1e-9 * aw) return [a0 + (b0 - a0) * t, w]
  return [a0 + ((b0 - a0) * (w - aw)) / (bw - aw), w]
}
/** Where the camera is */
export function camera(s: Spring): Box {
  // At rest: exactly the target (the curve below is off by float error at t = 1).
  if (s.t === 1) return { ...s.to }
  const [x0, w] = axis(s.from.x0, s.from.x1 - s.from.x0, s.to.x0, s.to.x1 - s.to.x0, s.t)
  const [y0, h] = axis(s.from.y0, s.from.y1 - s.from.y0, s.to.y0, s.to.y1 - s.to.y0, s.t)
  return { x0, y0, x1: x0 + w, y1: y0 + h }
}

/** Heads for `to` from where the camera is, zooming as fast as it was (a pan keeps its pace) */
export function retarget(s: Spring, to: Box) {
  const here = camera(s)
  const rate = s.v * (logArea(s.to) - logArea(s.from))
  const span = logArea(to) - logArea(here)
  s.v = Math.abs(span) > 1e-3 && Math.abs(logArea(s.to) - logArea(s.from)) > 1e-3 ? rate / span : 0
  Object.assign(s, { from: here, to, t: 0 })
}

/** Moves the spring on `dt` seconds; whether it has come to rest (then exactly at its target) */
export function advance(s: Spring, dt: number): boolean {
  for (let left = Math.min(dt, 1 / 20); left > 1e-9; left -= STEP) {
    const h = Math.min(STEP, left)
    s.v += (STIFFNESS * (1 - s.t) - DAMPING * s.v) * h
    s.t += s.v * h
  }
  const done = Math.abs(1 - s.t) < 1e-3 && Math.abs(s.v) < 1e-2
  if (done) (s.t = 1), (s.v = 0)
  return done
}

/** The spring carried into a space where the old one sits as `a` has it (as its views' boxes are) */
export function rebase(s: Spring, a: Affine) {
  s.from = mapBox(a, s.from)
  s.to = mapBox(a, s.to)
}
