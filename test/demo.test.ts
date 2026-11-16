import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { STEPS } from '../scripts/demo/agent.ts'

// The demo's scripted edits find their place by the lines they edit: when the source moves on,
// this fails here rather than halfway through a recording.
test('every demo edit still finds its anchor in the source', () => {
  for (const s of STEPS) {
    if ('create' in s) continue
    const anchor = 'after' in s ? s.after : s.replace
    assert.ok(fs.readFileSync(s.file, 'utf8').includes(anchor), `${s.file}: ${anchor}`)
  }
})
