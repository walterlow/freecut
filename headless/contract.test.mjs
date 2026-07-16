import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  HEADLESS_API_VERSION,
  EDIT_OPERATION_NAMES,
  capabilities,
  editOpSchema,
  editRequestSchema,
  normalizeRenderInput,
  renderRequestSchema,
  validate,
} from './lib/contract.mjs'
import { parseArgs } from './lib/cli.mjs'
import { listProjects, loadProject } from './lib/workspace.mjs'

const samples = {
  addText: { op: 'addText', text: 'hello', from: 0 },
  addItem: {
    op: 'addItem',
    item: { type: 'text', id: 'i', trackId: 'v', from: 0, durationInFrames: 1 },
  },
  updateItem: { op: 'updateItem', id: 'i', updates: { text: 'new' } },
  moveItem: { op: 'moveItem', id: 'i', from: 2, trackId: 'v' },
  removeItems: { op: 'removeItems', ids: ['i'] },
  split: { op: 'split', id: 'i', frame: 1 },
  trimStart: { op: 'trimStart', id: 'i', amount: 1 },
  trimEnd: { op: 'trimEnd', id: 'i', amount: 1 },
  addTransition: { op: 'addTransition', leftClipId: 'a', rightClipId: 'b', type: 'crossfade' },
  addTrack: { op: 'addTrack', kind: 'audio', order: 2 },
  updateTrack: { op: 'updateTrack', id: 'v', updates: { name: 'Video', locked: true } },
  removeTrack: { op: 'removeTrack', id: 'v' },
  addClip: { op: 'addClip', mediaId: 'm', from: 0 },
  addKeyframe: {
    op: 'addKeyframe',
    itemId: 'i',
    property: 'opacity',
    frame: 0,
    value: 1,
    easing: 'linear',
  },
  removeKeyframes: { op: 'removeKeyframes', itemId: 'i', property: 'effect:gpu-blur:e1:radius' },
  addEffect: {
    op: 'addEffect',
    itemId: 'i',
    gpuEffectType: 'gpu-gaussian-blur',
    params: { radius: 2 },
  },
  removeEffect: { op: 'removeEffect', itemId: 'i', effectId: 'e' },
  setTransform: { op: 'setTransform', id: 'i', transform: { opacity: 0.5, rotation: 2 } },
  addMarker: { op: 'addMarker', frame: 10, label: 'Beat' },
  updateMarker: { op: 'updateMarker', id: 'marker', updates: { frame: 12 } },
  removeMarker: { op: 'removeMarker', id: 'marker' },
  setInPoint: { op: 'setInPoint', frame: 5 },
  setOutPoint: { op: 'setOutPoint', frame: 60 },
  clearInOutPoints: { op: 'clearInOutPoints' },
  setMasterAudio: { op: 'setMasterAudio', masterBusDb: -3 },
  setProjectSettings: { op: 'setProjectSettings', name: 'Renamed', fps: 24 },
}

test('every published edit discriminator has a valid strict schema', () => {
  assert.deepEqual(Object.keys(samples), EDIT_OPERATION_NAMES)
  for (const op of EDIT_OPERATION_NAMES)
    assert.equal(editOpSchema.safeParse(samples[op]).success, true, op)
  assert.equal(editOpSchema.safeParse({ ...samples.addText, surprise: true }).success, false)
  assert.equal(editOpSchema.safeParse({ op: 'invented' }).success, false)
  assert.equal(
    editOpSchema.safeParse({ op: 'addEffect', itemId: 'i', gpuEffectType: 'gpu-invented' }).success,
    false,
  )
  assert.equal(editOpSchema.safeParse({ op: 'updateItem', id: 'i', updates: {} }).success, false)
  assert.equal(
    editOpSchema.safeParse({ op: 'setTransform', id: 'i', transform: {} }).success,
    false,
  )
})

test('edit request requires exactly one project source and nonempty valid ops', () => {
  assert.equal(editRequestSchema.safeParse({ project: 'p', ops: [] }).success, false)
  assert.equal(
    editRequestSchema.safeParse({ project: 'p', projectObject: {}, ops: [samples.addText] })
      .success,
    false,
  )
  assert.equal(editRequestSchema.safeParse({ project: 'p', ops: [samples.addText] }).success, true)
})

test('render request enforces finite bounds, ranges, enums, and canonical HTTP fields', () => {
  assert.equal(
    renderRequestSchema.safeParse({ project: 'p', fps: 1, resolution: '16x16' }).success,
    true,
  )
  assert.equal(
    renderRequestSchema.safeParse({ project: 'p', fps: 240, resolution: '16384x16384' }).success,
    true,
  )
  for (const invalid of [
    { project: 'p', fps: 0 },
    { project: 'p', fps: Number.NaN },
    { project: 'p', resolution: '15x1080' },
    { project: 'p', quality: 'best' },
    { project: 'p', inSec: 2, outSec: 1 },
    { project: 'p', duration: 0 },
    { project: 'p', in: 1 },
    { project: 'p', outSec: 2, duration: 1 },
    { project: 'p', container: 'mp3' },
    { project: 'p', audioOnly: true, container: 'webm' },
  ])
    assert.equal(renderRequestSchema.safeParse(invalid).success, false, JSON.stringify(invalid))
  assert.deepEqual(
    normalizeRenderInput({ project: 'p', in: '1', 'out-sec': '2', 'audio-only': true }),
    {
      project: 'p',
      inSec: 1,
      outSec: 2,
      audioOnly: true,
    },
  )
})

test('validation errors and capabilities are machine-readable and bounded', () => {
  assert.throws(
    () => validate(editRequestSchema, { project: 'p', ops: [] }),
    (error) => {
      assert.equal(error.code, 'VALIDATION_ERROR')
      assert.ok(error.fields.some((field) => field.path === 'ops'))
      return true
    },
  )
  const result = capabilities()
  assert.equal(result.apiVersion, HEADLESS_API_VERSION)
  assert.deepEqual(result.operations, EDIT_OPERATION_NAMES)
  assert.ok(result.schemas.render)
  assert.ok(JSON.stringify(result).length < 32_000)
})

test('CLI rejects unknown options and normalizes aliases', () => {
  const allowed = new Set(['inSec'])
  assert.deepEqual(parseArgs(['--in', '2'], { allowed, aliases: { in: 'inSec' } }), {
    _: [],
    inSec: '2',
  })
  assert.throws(() => parseArgs(['--typo'], { allowed }), /Unknown option/)
})

test('project listings expose distinct actionable directory ids', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freecut-contract-'))
  try {
    for (const dir of ['one', 'two']) {
      const projectDir = path.join(root, 'projects', dir)
      fs.mkdirSync(projectDir, { recursive: true })
      fs.writeFileSync(
        path.join(projectDir, 'project.json'),
        JSON.stringify({ id: 'duplicate', name: dir, updatedAt: 1 }),
      )
    }
    const listed = listProjects(root)
    assert.deepEqual(listed.map((entry) => entry.id).sort(), ['one', 'two'])
    assert.deepEqual(
      listed.map((entry) => entry.projectId),
      ['duplicate', 'duplicate'],
    )
    for (const entry of listed) assert.equal(loadProject(root, entry.id).project.name, entry.name)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
