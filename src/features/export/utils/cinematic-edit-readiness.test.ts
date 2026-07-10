import { describe, expect, it } from 'vitest'
import type { CompositionInputProps } from '@/types/export'
import type { ItemKeyframes } from '@/types/keyframe'
import type { TimelineItem, TimelineTrack } from '@/types/timeline'
import { scoreCinematicEditReadiness } from './cinematic-edit-readiness'
import { convertTimelineToComposition } from './timeline-to-composition'

function image(id: string, from: number, depth = true): TimelineItem {
  return {
    id,
    trackId: 'v1',
    type: 'image',
    label: `${id}.png`,
    src: `blob:${id}`,
    from,
    durationInFrames: 90,
    cinematicDepthRole: depth ? 'subject' : 'flat',
  }
}

function audio(id: string, label: string, role?: TimelineItem['audiobookSfxRole']): TimelineItem {
  return {
    id,
    trackId: 'a1',
    type: 'audio',
    label,
    src: `blob:${id}`,
    from: 0,
    durationInFrames: 270,
    audiobookSfxRole: role,
  }
}

function cameraKeyframes(itemId: string): ItemKeyframes {
  return cameraKeyframesForDuration(itemId, 90)
}

function cameraKeyframesForDuration(itemId: string, durationInFrames: number): ItemKeyframes {
  const midFrame = Math.round(durationInFrames / 2)
  return {
    itemId,
    properties: [
      {
        property: 'x',
        keyframes: [
          { id: `${itemId}-x-1`, frame: 0, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-x-2`, frame: midFrame, value: 40, easing: 'ease-in-out' },
          { id: `${itemId}-x-3`, frame: durationInFrames, value: 70, easing: 'ease-in-out' },
        ],
      },
      {
        property: 'y',
        keyframes: [
          { id: `${itemId}-y-1`, frame: 0, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-y-2`, frame: durationInFrames, value: -44, easing: 'ease-in-out' },
        ],
      },
      {
        property: 'width',
        keyframes: [
          { id: `${itemId}-w-1`, frame: 0, value: 1920, easing: 'ease-in-out' },
          { id: `${itemId}-w-2`, frame: durationInFrames, value: 2240, easing: 'ease-in-out' },
        ],
      },
    ],
  }
}

function sequentialCameraKeyframes(itemId: string): ItemKeyframes {
  return {
    itemId,
    properties: [
      {
        property: 'width',
        keyframes: [
          { id: `${itemId}-w-1`, frame: 0, value: 1920, easing: 'ease-in-out' },
          { id: `${itemId}-w-2`, frame: 45, value: 2240, easing: 'ease-in-out' },
          { id: `${itemId}-w-3`, frame: 90, value: 2240, easing: 'ease-in-out' },
        ],
      },
      {
        property: 'x',
        keyframes: [
          { id: `${itemId}-x-1`, frame: 0, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-x-2`, frame: 45, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-x-3`, frame: 90, value: 80, easing: 'ease-in-out' },
        ],
      },
      {
        property: 'y',
        keyframes: [
          { id: `${itemId}-y-1`, frame: 0, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-y-2`, frame: 45, value: 0, easing: 'ease-in-out' },
          { id: `${itemId}-y-3`, frame: 90, value: -52, easing: 'ease-in-out' },
        ],
      },
    ],
  }
}

function composition(overrides: Partial<CompositionInputProps> = {}): CompositionInputProps {
  const items = [image('img-1', 0), image('img-2', 90), image('img-3', 180)]
  const tracks: TimelineTrack[] = [
    {
      id: 'v1',
      name: 'Video',
      kind: 'video',
      height: 72,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 0,
      items,
    },
    {
      id: 'a1',
      name: 'Audio',
      kind: 'audio',
      height: 72,
      locked: false,
      visible: true,
      muted: false,
      solo: false,
      order: 1,
      items: [
        audio('score', 'Audiobook score bed'),
        audio('ambience', 'Audiobook SFX ambience', 'ambience'),
        audio('foley', 'Audiobook SFX foley', 'foreground'),
        audio('impact', 'Audiobook SFX impact', 'impact'),
      ],
    },
  ]

  return {
    fps: 30,
    durationInFrames: 270,
    width: 3840,
    height: 2160,
    tracks,
    keyframes: items.map((item) => cameraKeyframes(item.id)),
    ...overrides,
  }
}

describe('scoreCinematicEditReadiness', () => {
  it('rates a staged multi-axis depth edit with score bed and SFX as excellent', () => {
    const score = scoreCinematicEditReadiness(composition())

    expect(score.grade).toBe('excellent')
    expect(score.metrics.imageCoveragePct).toBe(100)
    expect(score.metrics.multiAxisImagePct).toBe(100)
    expect(score.metrics.stagedCameraPct).toBe(100)
    expect(score.metrics.referenceStyleCameraPct).toBe(100)
    expect(score.metrics.averageImageShotSeconds).toBe(3)
    expect(score.metrics.shotRhythmScore).toBe(10)
    expect(score.metrics.sfxRoleScore).toBe(10)
    expect(score.issues).toHaveLength(0)
  })

  it('flags a simple still-image slideshow without depth, music, or SFX', () => {
    const flatImages = [image('img-1', 0, false), image('img-2', 90, false)]
    const score = scoreCinematicEditReadiness(
      composition({
        durationInFrames: 270,
        tracks: [
          {
            id: 'v1',
            name: 'Video',
            kind: 'video',
            height: 72,
            locked: false,
            visible: true,
            muted: false,
            solo: false,
            order: 0,
            items: flatImages,
          },
        ],
        keyframes: [],
      }),
    )

    expect(score.grade).toBe('weak')
    expect(score.metrics.imageCoveragePct).toBeLessThan(90)
    expect(score.metrics.multiAxisImagePct).toBe(0)
    expect(score.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining([
        'edit-image-coverage-low',
        'edit-motion-too-simple',
        'edit-reference-camera-low',
        'edit-depth-underprepared',
        'edit-sfx-thin',
        'edit-no-score-bed',
      ]),
    )
  })

  it('scores the converted selected export range instead of whole-timeline positions', () => {
    const rangeStart = 300
    const items = [
      image('img-1', rangeStart),
      image('img-2', rangeStart + 90),
      image('img-3', rangeStart + 180),
    ]
    const audioItems = [
      {
        ...audio('score', 'Audiobook score bed'),
        from: rangeStart,
      },
      {
        ...audio('ambience', 'Audiobook SFX ambience', 'ambience'),
        from: rangeStart,
      },
      {
        ...audio('foley', 'Audiobook SFX foley', 'foreground'),
        from: rangeStart,
      },
      {
        ...audio('impact', 'Audiobook SFX impact', 'impact'),
        from: rangeStart,
      },
    ]
    const tracks = [
      {
        id: 'v1',
        name: 'Video',
        kind: 'video' as const,
        height: 72,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 0,
        items,
      },
      {
        id: 'a1',
        name: 'Audio',
        kind: 'audio' as const,
        height: 72,
        locked: false,
        visible: true,
        muted: false,
        solo: false,
        order: 1,
        items: audioItems,
      },
    ]

    const converted = convertTimelineToComposition(
      tracks,
      [...items, ...audioItems],
      [],
      30,
      3840,
      2160,
      rangeStart,
      rangeStart + 270,
      items.map((item) => cameraKeyframes(item.id)),
    )
    const score = scoreCinematicEditReadiness(converted)

    expect(converted.durationInFrames).toBe(270)
    expect(converted.tracks.flatMap((track) => track.items).every((item) => item.from >= 0)).toBe(
      true,
    )
    expect(score.metrics.imageCoveragePct).toBe(100)
    expect(score.grade).toBe('excellent')
  })

  it('rejects sequential zoom-then-pan motion as below the reference camera style', () => {
    const base = composition()
    const score = scoreCinematicEditReadiness({
      ...base,
      keyframes: base.keyframes?.map((entry) => sequentialCameraKeyframes(entry.itemId)),
    })

    expect(score.metrics.multiAxisImagePct).toBe(100)
    expect(score.metrics.stagedCameraPct).toBe(100)
    expect(score.metrics.referenceStyleCameraPct).toBe(0)
    expect(score.score).toBeLessThan(8.5)
    expect(score.grade).toBe('strong')
    expect(score.issues.map((issue) => issue.id)).toContain('edit-reference-camera-low')
  })

  it('penalizes long, identical still-image durations as flat export pacing', () => {
    const shotFrames = 360
    const items = Array.from({ length: 4 }, (_, index) => ({
      ...image(`img-${index + 1}`, index * shotFrames),
      durationInFrames: shotFrames,
    }))
    const base = composition({
      durationInFrames: shotFrames * items.length,
      tracks: [
        {
          id: 'v1',
          name: 'Video',
          kind: 'video',
          height: 72,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 0,
          items,
        },
        {
          id: 'a1',
          name: 'Audio',
          kind: 'audio',
          height: 72,
          locked: false,
          visible: true,
          muted: false,
          solo: false,
          order: 1,
          items: [
            audio('score', 'Audiobook score bed'),
            audio('ambience', 'Audiobook SFX ambience', 'ambience'),
            audio('foley', 'Audiobook SFX foley', 'foreground'),
            audio('impact', 'Audiobook SFX impact', 'impact'),
          ].map((item) => ({ ...item, durationInFrames: shotFrames * items.length })),
        },
      ],
      keyframes: items.map((item) => cameraKeyframesForDuration(item.id, shotFrames)),
    })
    const score = scoreCinematicEditReadiness(base)

    expect(score.metrics.imageCoveragePct).toBe(100)
    expect(score.metrics.referenceStyleCameraPct).toBe(100)
    expect(score.metrics.averageImageShotSeconds).toBe(12)
    expect(score.metrics.imageShotDurationStdDevSeconds).toBe(0)
    expect(score.metrics.shotRhythmScore).toBeLessThan(7)
    expect(score.score).toBeLessThan(8.5)
    expect(score.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(['edit-shot-too-long', 'edit-shot-rhythm-flat']),
    )
  })
})
