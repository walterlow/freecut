// Portable Chrome contract test for every public headless edit operation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createHarnessServer } from './server.mjs'
import { chromeLaunchArgs } from './lib/cli.mjs'
import { EDIT_OPERATION_NAMES, editOpSchema } from './lib/contract.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function baseProject() {
  return {
    id: 'edit-contract',
    name: 'Edit contract',
    description: '',
    schemaVersion: 10,
    createdAt: 1_735_689_600_000,
    updatedAt: 1_735_689_600_000,
    duration: 120,
    metadata: { width: 1280, height: 720, fps: 30, backgroundColor: '#000000' },
    timeline: {
      masterBusDb: 0,
      tracks: [
        {
          id: 'video-1',
          name: 'V1',
          kind: 'video',
          height: 60,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items: [],
        },
        {
          id: 'video-2',
          name: 'V2',
          kind: 'video',
          height: 60,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          order: 1,
          items: [],
        },
        {
          id: 'audio-1',
          name: 'A1',
          kind: 'audio',
          height: 60,
          locked: false,
          syncLock: true,
          visible: true,
          muted: false,
          solo: false,
          order: 2,
          items: [],
        },
      ],
      items: [
        {
          id: 'text-1',
          type: 'text',
          trackId: 'video-1',
          from: 0,
          durationInFrames: 90,
          label: 'Title',
          text: 'hello',
          color: '#fff',
          fontSize: 80,
          textAlign: 'center',
          verticalAlign: 'middle',
          transform: {},
        },
        {
          id: 'clip-left',
          type: 'video',
          trackId: 'video-2',
          from: 0,
          durationInFrames: 30,
          label: 'Left',
          mediaId: 'existing',
          src: '',
          volume: 0,
          sourceStart: 0,
          sourceEnd: 30,
          sourceDuration: 60,
          sourceFps: 30,
          speed: 1,
          transform: {},
        },
        {
          id: 'clip-right',
          type: 'video',
          trackId: 'video-2',
          from: 30,
          durationInFrames: 30,
          label: 'Right',
          mediaId: 'existing',
          src: '',
          volume: 0,
          sourceStart: 30,
          sourceEnd: 60,
          sourceDuration: 90,
          sourceFps: 30,
          speed: 1,
          transform: {},
        },
      ],
      transitions: [],
      keyframes: [],
      markers: [],
      inPoint: null,
      outPoint: null,
      compositions: [],
    },
  }
}

const item = (project, id) => project.timeline.items.find((candidate) => candidate.id === id)
const roundTrip = (project) => JSON.parse(JSON.stringify(project))

const cases = [
  {
    name: 'addText',
    op: {
      op: 'addText',
      id: 'new-text',
      text: 'added',
      from: 10,
      durationInFrames: 20,
      trackId: 'video-1',
    },
    assert: (project) => assert.equal(item(project, 'new-text')?.text, 'added'),
    failure: { op: 'addText', id: 'bad-text', trackId: 'missing-track' },
  },
  {
    name: 'addItem',
    op: {
      op: 'addItem',
      item: {
        id: 'new-item',
        type: 'text',
        trackId: 'video-1',
        from: 5,
        durationInFrames: 15,
        text: 'raw',
        label: 'Raw',
        color: '#fff',
        fontSize: 50,
      },
    },
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'new-item')?.label, item(project, 'new-item')?.durationInFrames],
        ['Raw', 15],
      ),
    failure: {
      op: 'addItem',
      item: { type: 'text', trackId: 'missing-track', from: 0, durationInFrames: 10 },
    },
  },
  {
    name: 'updateItem',
    op: { op: 'updateItem', id: 'text-1', updates: { label: 'Updated' } },
    assert: (project) => assert.equal(item(project, 'text-1')?.label, 'Updated'),
    failure: { op: 'updateItem', id: 'missing', updates: { label: 'nope' } },
  },
  {
    name: 'moveItem',
    op: { op: 'moveItem', id: 'text-1', from: 12, trackId: 'video-2' },
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'text-1')?.from, item(project, 'text-1')?.trackId],
        [12, 'video-2'],
      ),
    failure: { op: 'moveItem', id: 'missing', from: 2 },
  },
  {
    name: 'removeItems',
    op: { op: 'removeItems', ids: ['text-1'] },
    assert: (project) => assert.equal(item(project, 'text-1'), undefined),
    failure: { op: 'removeItems', ids: ['missing'] },
  },
  {
    name: 'split',
    op: { op: 'split', id: 'clip-left', frame: 15 },
    assert: (project) => {
      const parts = project.timeline.items.filter((candidate) => candidate.label === 'Left')
      assert.equal(parts.length, 2)
      assert.equal(
        parts.reduce((sum, candidate) => sum + candidate.durationInFrames, 0),
        30,
      )
    },
    failure: { op: 'split', id: 'clip-left', frame: 0 },
  },
  {
    name: 'trimStart',
    op: { op: 'trimStart', id: 'text-1', amount: 5 },
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'text-1')?.from, item(project, 'text-1')?.durationInFrames],
        [5, 85],
      ),
    failure: { op: 'trimStart', id: 'missing', amount: 5 },
  },
  {
    name: 'trimEnd',
    op: { op: 'trimEnd', id: 'text-1', amount: 5 },
    assert: (project) => assert.equal(item(project, 'text-1')?.durationInFrames, 95),
    failure: { op: 'trimEnd', id: 'missing', amount: 5 },
  },
  {
    name: 'addTransition',
    op: {
      op: 'addTransition',
      leftClipId: 'clip-left',
      rightClipId: 'clip-right',
      type: 'crossfade',
      durationInFrames: 10,
    },
    assert: (project) => assert.equal(project.timeline.transitions.length, 1),
    failure: {
      op: 'addTransition',
      leftClipId: 'clip-left',
      rightClipId: 'missing',
      durationInFrames: 10,
    },
  },
  {
    name: 'addTrack',
    op: { op: 'addTrack', kind: 'audio', order: 9 },
    assert: (project) =>
      assert.ok(
        project.timeline.tracks.some((track) => track.kind === 'audio' && track.order === 9),
      ),
    schemaFailure: { op: 'addTrack', kind: 'data' },
  },
  {
    name: 'updateTrack',
    op: {
      op: 'updateTrack',
      id: 'video-1',
      updates: { name: 'Primary', locked: true, order: 4 },
    },
    assert: (project) => {
      const track = project.timeline.tracks.find((candidate) => candidate.id === 'video-1')
      assert.deepEqual([track?.name, track?.locked, track?.order], ['Primary', true, 4])
    },
    failure: { op: 'updateTrack', id: 'missing', updates: { name: 'Nope' } },
  },
  {
    name: 'removeTrack',
    op: { op: 'removeTrack', id: 'audio-1' },
    assert: (project) =>
      assert.equal(
        project.timeline.tracks.some((candidate) => candidate.id === 'audio-1'),
        false,
      ),
    failure: { op: 'removeTrack', id: 'missing' },
  },
  {
    name: 'addClip',
    op: {
      op: 'addClip',
      mediaId: 'video-media',
      from: 20,
      durationInFrames: 30,
      trackId: 'video-1',
    },
    media: [
      {
        mediaId: 'video-media',
        metadata: {
          id: 'video-media',
          fileName: 'generated.mp4',
          mimeType: 'video/mp4',
          duration: 1,
          fps: 30,
          width: 320,
          height: 180,
          audioCodec: 'aac',
          audioCodecSupported: true,
        },
      },
    ],
    assert: (project) => {
      const linked = project.timeline.items.filter(
        (candidate) => candidate.mediaId === 'video-media',
      )
      assert.deepEqual(linked.map((candidate) => candidate.type).sort(), ['audio', 'video'])
      assert.equal(new Set(linked.map((candidate) => candidate.linkedGroupId)).size, 1)
    },
    failure: { op: 'addClip', mediaId: 'missing-media' },
  },
  {
    name: 'addKeyframe',
    op: {
      op: 'addKeyframe',
      itemId: 'text-1',
      property: 'opacity',
      frame: 10,
      value: 0.5,
      easing: 'linear',
    },
    assert: (project) =>
      assert.equal(project.timeline.keyframes[0]?.properties[0]?.keyframes[0]?.value, 0.5),
    failure: { op: 'addKeyframe', itemId: 'missing', property: 'opacity', frame: 10, value: 0.5 },
  },
  {
    name: 'removeKeyframes',
    ops: [
      { op: 'addKeyframe', itemId: 'text-1', property: 'opacity', frame: 10, value: 0.5 },
      { op: 'removeKeyframes', itemId: 'text-1', property: 'opacity' },
    ],
    op: { op: 'removeKeyframes', itemId: 'text-1', property: 'opacity' },
    assert: (project) =>
      assert.equal(
        project.timeline.keyframes.some(
          (group) =>
            group.itemId === 'text-1' &&
            group.properties.some((property) => property.property === 'opacity'),
        ),
        false,
      ),
    failure: { op: 'removeKeyframes', itemId: 'missing', property: 'opacity' },
  },
  {
    name: 'addEffect',
    op: { op: 'addEffect', itemId: 'text-1', gpuEffectType: 'gpu-invert', params: {} },
    assert: (project) => assert.equal(item(project, 'text-1')?.effects?.length, 1),
    failure: { op: 'addEffect', itemId: 'missing', gpuEffectType: 'gpu-invert', params: {} },
  },
  {
    name: 'removeEffect',
    setup: async (page) =>
      (
        await edit(page, baseProject(), [
          { op: 'addEffect', itemId: 'text-1', gpuEffectType: 'gpu-invert', params: {} },
        ])
      ).project,
    opFrom: (project) => ({
      op: 'removeEffect',
      itemId: 'text-1',
      effectId: item(project, 'text-1').effects[0].id,
    }),
    op: { op: 'removeEffect', itemId: 'text-1', effectId: 'effect-id' },
    assert: (project) => assert.equal(item(project, 'text-1')?.effects?.length ?? 0, 0),
    failure: { op: 'removeEffect', itemId: 'text-1', effectId: 'missing-effect' },
  },
  {
    name: 'setTransform',
    op: { op: 'setTransform', id: 'text-1', transform: { opacity: 0.4, x: 12 } },
    assert: (project) =>
      assert.deepEqual(
        [item(project, 'text-1')?.transform?.opacity, item(project, 'text-1')?.transform?.x],
        [0.4, 12],
      ),
    failure: { op: 'setTransform', id: 'missing', transform: { opacity: 0.4 } },
  },
  {
    name: 'addMarker',
    op: { op: 'addMarker', frame: 12, color: '#ff0000', label: 'Beat' },
    assert: (project) =>
      assert.ok(
        project.timeline.markers.some(
          (marker) => marker.frame === 12 && marker.color === '#ff0000' && marker.label === 'Beat',
        ),
      ),
    schemaFailure: { op: 'addMarker', frame: -1 },
  },
  {
    name: 'updateMarker',
    setup: async (page) =>
      (await edit(page, baseProject(), [{ op: 'addMarker', frame: 12, label: 'Before' }])).project,
    opFrom: (project) => ({
      op: 'updateMarker',
      id: project.timeline.markers[0].id,
      updates: { frame: 18, label: 'After' },
    }),
    op: { op: 'updateMarker', id: 'marker-id', updates: { label: 'After' } },
    assert: (project) =>
      assert.deepEqual(
        [project.timeline.markers[0]?.frame, project.timeline.markers[0]?.label],
        [18, 'After'],
      ),
    failure: { op: 'updateMarker', id: 'missing', updates: { label: 'Nope' } },
  },
  {
    name: 'removeMarker',
    setup: async (page) =>
      (await edit(page, baseProject(), [{ op: 'addMarker', frame: 12, label: 'Remove' }])).project,
    opFrom: (project) => ({ op: 'removeMarker', id: project.timeline.markers[0].id }),
    op: { op: 'removeMarker', id: 'marker-id' },
    assert: (project) => assert.equal(project.timeline.markers?.length ?? 0, 0),
    failure: { op: 'removeMarker', id: 'missing' },
  },
  {
    name: 'setInPoint',
    op: { op: 'setInPoint', frame: 10 },
    assert: (project) =>
      assert.deepEqual([project.timeline.inPoint, project.timeline.outPoint], [10, 300]),
    schemaFailure: { op: 'setInPoint', frame: -1 },
  },
  {
    name: 'setOutPoint',
    op: { op: 'setOutPoint', frame: 60 },
    assert: (project) =>
      assert.deepEqual([project.timeline.inPoint, project.timeline.outPoint], [0, 60]),
    schemaFailure: { op: 'setOutPoint', frame: -1 },
  },
  {
    name: 'clearInOutPoints',
    ops: [{ op: 'setInPoint', frame: 10 }, { op: 'clearInOutPoints' }],
    op: { op: 'clearInOutPoints' },
    assert: (project) =>
      assert.deepEqual(
        [project.timeline.inPoint ?? null, project.timeline.outPoint ?? null],
        [null, null],
      ),
    schemaFailure: { op: 'clearInOutPoints', frame: 1 },
  },
  {
    name: 'setMasterAudio',
    op: { op: 'setMasterAudio', masterBusDb: -3, busAudioEq: { enabled: true } },
    assert: (project) =>
      assert.deepEqual(
        [project.timeline.masterBusDb, project.timeline.busAudioEq?.enabled],
        [-3, true],
      ),
    schemaFailure: { op: 'setMasterAudio' },
  },
  {
    name: 'setProjectSettings',
    op: {
      op: 'setProjectSettings',
      name: 'Renamed',
      duration: 240,
      width: 1920,
      height: 1080,
      fps: 24,
      backgroundColor: '#112233',
    },
    assert: (project) =>
      assert.deepEqual(
        [
          project.name,
          project.duration,
          project.metadata.width,
          project.metadata.height,
          project.metadata.fps,
          project.metadata.backgroundColor,
        ],
        ['Renamed', 240, 1920, 1080, 24, '#112233'],
      ),
    schemaFailure: { op: 'setProjectSettings', fps: 0 },
  },
]

async function edit(page, project, ops, media) {
  return page.evaluate((input) => window.freecut.editProject(input), { project, ops, media })
}

async function main() {
  const distDir = path.join(ROOT, 'dist')
  if (!fs.existsSync(path.join(distDir, 'headless.html'))) {
    throw new Error('dist/headless.html is missing; run npm run build first')
  }
  assert.deepEqual(
    cases.map(({ name }) => name).sort(),
    [...EDIT_OPERATION_NAMES].sort(),
    'schema/test operation parity',
  )
  for (const testCase of cases)
    assert.equal(
      editOpSchema.safeParse(testCase.op).success,
      true,
      `${testCase.name} success payload schema`,
    )

  const server = await createHarnessServer({ distDir })
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: chromeLaunchArgs(),
  })
  try {
    const page = await browser.newPage()
    await page.goto(server.harnessUrl, { waitUntil: 'load', timeout: 60_000 })
    await page.waitForFunction(() => Boolean(window.freecut?.ready), { timeout: 30_000 })

    for (const testCase of cases) {
      const project = testCase.setup ? await testCase.setup(page) : baseProject()
      const operation = testCase.opFrom ? testCase.opFrom(project) : testCase.op
      const result = await edit(page, project, testCase.ops ?? [operation], testCase.media)
      assert.equal(result.ok, true, `${testCase.name} reports success`)
      testCase.assert(roundTrip(result.project))

      if (testCase.schemaFailure) {
        assert.equal(
          editOpSchema.safeParse(testCase.schemaFailure).success,
          false,
          `${testCase.name} rejects invalid schema`,
        )
      } else {
        assert.equal(
          editOpSchema.safeParse(testCase.failure).success,
          true,
          `${testCase.name} failure payload schema`,
        )
        await assert.rejects(
          edit(page, baseProject(), [testCase.failure]),
          undefined,
          `${testCase.name} meaningful failure`,
        )
      }
      process.stdout.write(`  PASS  ${testCase.name}\n`)
    }
  } finally {
    await browser.close()
    await server.close()
  }
  process.stdout.write(`All ${cases.length} edit operation contracts passed\n`)
}

main().catch((error) => {
  process.stderr.write(`Edit operation contract failed: ${error.stack ?? error}\n`)
  process.exitCode = 1
})
