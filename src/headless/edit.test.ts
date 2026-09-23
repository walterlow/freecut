import { describe, expect, it } from 'vite-plus/test'
import type { Project, ProjectTimeline } from '@/types/project'
import type { MediaMetadata } from '@/types/storage'
import { editProject } from './edit'
import type { EditOp } from './edit-op-support'

/**
 * Integration tests through the REAL timeline stores/actions (the module
 * hydrates stores from the project and serializes them back) — this is the
 * interpreter every headless montage build runs on.
 */

function baseProject(timeline?: Partial<ProjectTimeline>): Project {
  return {
    id: 'p1',
    name: 'edit-test',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 300,
    schemaVersion: 14,
    metadata: { width: 1920, height: 1080, fps: 25 },
    timeline: {
      tracks: [
        {
          id: 't_v',
          name: 'V1',
          kind: 'video',
          height: 80,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
        },
      ],
      items: [],
      transitions: [],
      keyframes: [],
      currentFrame: 0,
      zoomLevel: 1,
      scrollPosition: 0,
      ...timeline,
    } as ProjectTimeline,
  } as Project
}

const videoMedia: MediaMetadata = {
  id: 'm-vid',
  fileName: 'clip.mp4',
  fileSize: 1,
  mimeType: 'video/mp4',
  duration: 4,
  width: 1920,
  height: 1080,
  fps: 30,
  codec: 'h264',
  audioCodec: 'aac',
  bitrate: 1,
} as MediaMetadata

describe('editProject', () => {
  it('addText places a text item with defaults on the existing video track', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [{ op: 'addText', text: 'Привет', from: 10 } as EditOp],
    })
    expect(result.applied).toBe(1)
    const items = result.project.timeline!.items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      type: 'text',
      text: 'Привет',
      trackId: 't_v',
      from: 10,
      durationInFrames: 90,
    })
  })

  it('a project with zero tracks gets a default track during hydration (addText still lands)', async () => {
    const result = await editProject({
      project: baseProject({ tracks: [] }),
      ops: [{ op: 'addText', text: 'x' } as EditOp],
    })
    expect(result.project.timeline!.items).toHaveLength(1)
    const trackId = result.project.timeline!.items[0]!.trackId
    expect(result.project.timeline!.tracks.some((t) => t.id === trackId)).toBe(true)
  })

  it('addTrack follows the order convention: video on top, audio at the bottom', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [
        { op: 'addTrack', kind: 'video' } as EditOp,
        { op: 'addTrack', kind: 'audio' } as EditOp,
      ],
    })
    const tracks = result.project.timeline!.tracks
    const orders = Object.fromEntries(tracks.map((t) => [t.kind ?? 'video', t.order]))
    const video = tracks.filter((t) => (t.kind ?? 'video') === 'video').map((t) => t.order)
    // New video track goes above the existing one (order 0 → min-1 = -1).
    expect(Math.min(...video)).toBe(-1)
    expect(orders['audio']).toBe(1)
  })

  it('resolves $ref chains between operations (track from a prior op)', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [
        { op: 'addTrack', kind: 'video', callerId: 'newTrack' } as EditOp,
        {
          op: 'addText',
          text: 'on new track',
          trackId: { $ref: 'newTrack#/detail/trackId' },
        } as EditOp,
      ],
    })
    const trackId = (result.results[0]!.detail as { trackId: string }).trackId
    const item = result.project.timeline!.items[0]!
    expect(item.trackId).toBe(trackId)
    expect(item.trackId).not.toBe('t_v')
  })

  it('split produces left/right ids and both halves land in the project', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [
        { op: 'addText', text: 'x', from: 0, durationInFrames: 100, callerId: 'a' } as EditOp,
        { op: 'split', id: { $ref: 'a#/detail/id' }, frame: 40 } as EditOp,
      ],
    })
    const detail = result.results[1]!.detail as { leftId: string; rightId: string }
    expect(detail.leftId).toBeTruthy()
    expect(detail.rightId).toBeTruthy()
    const items = result.project.timeline!.items
    expect(items.map((i) => i.durationInFrames).sort((a, b) => a - b)).toEqual([40, 60])
    expect(items.find((i) => i.id === detail.rightId)!.from).toBe(40)
  })

  it('removeItems accepts $ref inside the ids array', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [
        { op: 'addText', text: 'x', callerId: 'a' } as EditOp,
        { op: 'removeItems', ids: [{ $ref: 'a#/detail/id' }] } as EditOp,
      ],
    })
    expect(result.project.timeline!.items).toHaveLength(0)
  })

  it('rejects duplicate callerIds', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [
          { op: 'addText', text: 'x', callerId: 'dup' } as EditOp,
          { op: 'addText', text: 'y', callerId: 'dup' } as EditOp,
        ],
      }),
    ).rejects.toThrow(/Duplicate edit callerId/)
  })

  it('rejects a $ref to an unknown prior operation', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [{ op: 'addText', text: 'x', trackId: { $ref: 'nope#/detail/trackId' } } as EditOp],
      }),
    ).rejects.toThrow(/not a prior successful operation/)
  })

  it('rejects $ref in non-id fields (no data smuggling through refs)', async () => {
    await expect(
      editProject({
        project: baseProject(),
        ops: [
          { op: 'addText', text: 'x', callerId: 'a' } as EditOp,
          { op: 'addText', text: { $ref: 'a#/detail/id' } } as EditOp,
        ],
      }),
    ).rejects.toThrow(/\$ref is not allowed/)
  })

  it('addClip (video with audio) creates a linked audio companion with source-native frames', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [{ op: 'addClip', mediaId: 'm-vid', from: 5 } as EditOp],
      media: [{ mediaId: 'm-vid', metadata: videoMedia }],
    })
    const items = result.project.timeline!.items
    expect(items).toHaveLength(2)
    const video = items.find((i) => i.type === 'video')!
    const audio = items.find((i) => i.type === 'audio')!
    // Linked pair shares the group and the source cut.
    expect((video as { linkedGroupId?: string }).linkedGroupId).toBeTruthy()
    expect((audio as { linkedGroupId?: string }).linkedGroupId).toBe(
      (video as { linkedGroupId?: string }).linkedGroupId,
    )
    // 4s at source fps 30 → sourceEnd 120 (source-native frames, not project fps).
    expect(video).toMatchObject({ sourceStart: 0, sourceEnd: 120, sourceFps: 30 })
    // 4s at project fps 25 → 100 timeline frames.
    expect(video.durationInFrames).toBe(100)
    // The audio companion got its own bottom track.
    const audioTrack = result.project.timeline!.tracks.find((t) => t.id === audio.trackId)!
    expect(audioTrack.kind).toBe('audio')
  })

  it('addClip image defaults to a 150-frame still', async () => {
    const result = await editProject({
      project: baseProject(),
      ops: [{ op: 'addClip', mediaId: 'm-img' } as EditOp],
      media: [
        {
          mediaId: 'm-img',
          metadata: {
            ...videoMedia,
            id: 'm-img',
            mimeType: 'image/png',
            audioCodec: undefined,
          } as MediaMetadata,
        },
      ],
    })
    expect(result.project.timeline!.items[0]).toMatchObject({
      type: 'image',
      durationInFrames: 150,
      mediaId: 'm-img',
    })
  })

  const adjacentVideoTimeline = () => ({
    items: [
      {
        id: 'A',
        type: 'video',
        trackId: 't_v',
        from: 0,
        durationInFrames: 50,
        mediaId: 'm-vid',
        sourceStart: 15,
        sourceEnd: 75,
        sourceDuration: 120,
        speed: 1,
        label: 'A',
      },
      {
        id: 'B',
        type: 'video',
        trackId: 't_v',
        from: 50,
        durationInFrames: 50,
        mediaId: 'm-vid',
        sourceStart: 55,
        sourceEnd: 115,
        sourceDuration: 120,
        speed: 1,
        label: 'B',
      },
    ] as never,
  })

  it('addTransition carries GPU presentation, alignment and shader properties', async () => {
    const result = await editProject({
      project: baseProject(adjacentVideoTimeline()),
      media: [{ mediaId: 'm-vid', metadata: videoMedia }],
      ops: [
        {
          op: 'addTransition',
          leftClipId: 'A',
          rightClipId: 'B',
          durationInFrames: 10,
          presentation: 'glitch',
          alignment: 0.4,
          timing: 'ease-in-out',
          properties: { intensity: 2 },
          callerId: 'tr',
        } as EditOp,
      ],
    })
    const transitions = result.project.timeline!.transitions!
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({
      type: 'crossfade',
      leftClipId: 'A',
      rightClipId: 'B',
      durationInFrames: 10,
      presentation: 'glitch',
      alignment: 0.4,
      timing: 'ease-in-out',
      properties: { intensity: 2 },
    })
    expect((result.results[0]!.detail as { id?: string }).id).toBe(transitions[0]!.id)
  })

  it('updateTransition and removeTransition round-trip through $ref', async () => {
    const base = {
      project: baseProject(adjacentVideoTimeline()),
      media: [{ mediaId: 'm-vid', metadata: videoMedia }],
    }
    const updated = await editProject({
      ...base,
      ops: [
        { op: 'addTransition', leftClipId: 'A', rightClipId: 'B', callerId: 'tr' } as EditOp,
        {
          op: 'updateTransition',
          id: { $ref: 'tr#/detail/id' },
          presentation: 'wipe',
          direction: 'from-left',
        } as EditOp,
      ],
    })
    expect(updated.project.timeline!.transitions![0]).toMatchObject({
      presentation: 'wipe',
      direction: 'from-left',
    })

    const removed = await editProject({
      ...base,
      ops: [
        { op: 'addTransition', leftClipId: 'A', rightClipId: 'B', callerId: 'tr' } as EditOp,
        { op: 'removeTransition', id: { $ref: 'tr#/detail/id' } } as EditOp,
      ],
    })
    expect(removed.project.timeline!.transitions ?? []).toHaveLength(0)
  })

  it('updateTransition fails loudly when the store rejects the new duration', async () => {
    // Regression: the store action validates against the handles available on
    // both clips and, on rejection, only logs — it returns void. The op used to
    // report ok while the transition kept its old duration.
    await expect(
      editProject({
        project: baseProject(adjacentVideoTimeline()),
        media: [{ mediaId: 'm-vid', metadata: videoMedia }],
        ops: [
          { op: 'addTransition', leftClipId: 'A', rightClipId: 'B', callerId: 'tr' } as EditOp,
          {
            op: 'updateTransition',
            id: { $ref: 'tr#/detail/id' },
            // Far longer than either clip, so no handle arrangement can fit it.
            durationInFrames: 100_000,
          } as EditOp,
        ],
      }),
    ).rejects.toThrow(/was rejected: durationInFrames=100000/)
  })

  it('removeTransition on an unknown id fails loudly', async () => {
    await expect(
      editProject({
        project: baseProject(adjacentVideoTimeline()),
        ops: [{ op: 'removeTransition', id: 'ghost' } as EditOp],
      }),
    ).rejects.toThrow('transition "ghost" does not exist')
  })

  it('setTransformParent binds via the real action and round-trips the binding', async () => {
    const result = await editProject({
      project: baseProject(adjacentVideoTimeline()),
      media: [{ mediaId: 'm-vid', metadata: videoMedia }],
      ops: [{ op: 'setTransformParent', id: 'B', parentItemId: 'A' } as EditOp],
    })
    const child = result.project.timeline!.items.find((item) => item.id === 'B') as Record<
      string,
      unknown
    >
    const binding = child.transformParent as {
      parentItemId?: string
      parentReference?: { width: number }
      childLocalReference: { width: number }
      childWorldReference: { width: number }
    }
    expect(binding?.parentItemId).toBe('A')
    // The action computes bind references from resolved transforms — all present and sane.
    expect(binding.childLocalReference.width).toBeGreaterThan(0)
    expect(binding.childWorldReference.width).toBeGreaterThan(0)
    expect(binding.parentReference?.width).toBeGreaterThan(0)

    const detached = await editProject({
      project: result.project,
      media: [{ mediaId: 'm-vid', metadata: videoMedia }],
      ops: [{ op: 'setTransformParent', id: 'B', parentItemId: null } as EditOp],
    })
    const freed = detached.project.timeline!.items.find((item) => item.id === 'B') as {
      transformParent?: { parentItemId?: string }
    }
    // Detach keeps the bind-space record but drops the parent link.
    expect(freed.transformParent?.parentItemId).toBeUndefined()
  })

  it('setTransformParent fails loudly on a missing parent', async () => {
    await expect(
      editProject({
        project: baseProject(adjacentVideoTimeline()),
        ops: [{ op: 'setTransformParent', id: 'A', parentItemId: 'ghost' } as EditOp],
      }),
    ).rejects.toThrow('parentItemId: item "ghost" does not exist')
  })

  it('addKeyframe carries a custom spring easingConfig', async () => {
    const result = await editProject({
      project: baseProject(adjacentVideoTimeline()),
      ops: [
        {
          op: 'addKeyframe',
          itemId: 'A',
          property: 'rotation',
          frame: 0,
          value: 0,
          easing: 'spring',
          easingConfig: { type: 'spring', spring: { tension: 300, friction: 10, mass: 1 } },
        } as EditOp,
      ],
    })
    const group = result.project.timeline!.keyframes!.find(
      (candidate) => candidate.itemId === 'A',
    ) as unknown as {
      properties: Array<{ property: string; keyframes: Array<Record<string, unknown>> }>
    }
    const rotation = group.properties.find((candidate) => candidate.property === 'rotation')!
    expect(rotation.keyframes[0]).toMatchObject({
      easing: 'spring',
      easingConfig: { type: 'spring', spring: { tension: 300, friction: 10, mass: 1 } },
    })
  })
})
