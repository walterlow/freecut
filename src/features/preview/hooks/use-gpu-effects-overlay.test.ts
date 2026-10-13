import { describe, expect, it } from 'vite-plus/test'
import {
  buildContinuousPreviewOverlayIndex,
  getContinuousPreviewOverlayFrameWindow,
  shouldForceContinuousPreviewOverlayFromIndex,
  shouldForceContinuousPreviewOverlay,
  shouldForceContinuousPreviewOverlayInWindow,
  timelineHasContinuousOverlayContent,
} from './use-gpu-effects-overlay'
import type { TimelineItem } from '@/types/timeline'
import type { Transition } from '@/types/transition'
import type { SubComposition } from '@/features/preview/deps/timeline-store'

function createVideoItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'item-1',
    type: 'video',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 90,
    label: 'Video',
    src: 'blob:video',
    ...overrides,
  } as TimelineItem
}

function createCompositionItem(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: 'comp-1',
    type: 'composition',
    trackId: 'track-1',
    from: 0,
    durationInFrames: 120,
    label: 'Comp',
    compositionId: 'sub-1',
    compositionWidth: 1920,
    compositionHeight: 1080,
    ...overrides,
  } as TimelineItem
}

function createSubComposition(items: TimelineItem[]): SubComposition {
  return {
    id: 'sub-1',
    name: 'Sub',
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 120,
    tracks: [],
    transitions: [],
    keyframes: [],
    items,
  }
}

describe('shouldForceContinuousPreviewOverlay', () => {
  it('indexes only rendered-overlay candidates for per-frame checks', () => {
    const ordinaryItems = Array.from({ length: 327 }, (_, index) =>
      createVideoItem({
        id: `ordinary-${index}`,
        from: index * 90,
      }),
    )
    const effectedItem = createVideoItem({
      id: 'effected',
      from: 30_000,
      effects: [
        {
          id: 'effect-1',
          enabled: true,
          effect: {
            type: 'gpu-effect',
            gpuEffectType: 'gpu-blur',
            params: { amount: 0.5 },
          },
        },
      ],
    })
    const index = buildContinuousPreviewOverlayIndex([...ordinaryItems, effectedItem], [])

    expect(index.candidateItems.map((item) => item.id)).toEqual(['effected'])
    expect(
      shouldForceContinuousPreviewOverlayFromIndex(index, {
        startFrame: 30_000,
        endFrameExclusive: 30_001,
      }),
    ).toBe(true)
    expect(
      shouldForceContinuousPreviewOverlayFromIndex(index, {
        startFrame: 0,
        endFrameExclusive: 1,
      }),
    ).toBe(false)
  })

  it('keeps numeric transition counts as a non-forcing legacy hint', () => {
    expect(shouldForceContinuousPreviewOverlay([createVideoItem()], 1, 0)).toBe(false)
  })

  it('forces continuous overlay on active transition frames', () => {
    const left = createVideoItem({
      id: 'clip-left',
      from: 0,
      durationInFrames: 60,
    })
    const right = createVideoItem({
      id: 'clip-right',
      from: 40,
      durationInFrames: 60,
    })
    const transition: Transition = {
      id: 'transition-1',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: left.id,
      rightClipId: right.id,
      trackId: 'track-1',
      durationInFrames: 20,
      alignment: 0.5,
      createdAt: Date.now(),
    }

    expect(
      shouldForceContinuousPreviewOverlay([left, right], [transition], 47, undefined, undefined, {
        forceTransitionFrames: true,
      }),
    ).toBe(true)
    expect(
      shouldForceContinuousPreviewOverlay([left, right], [transition], 70, undefined, undefined, {
        forceTransitionFrames: true,
      }),
    ).toBe(false)
  })

  it('does not force transition frames unless requested by skim preview mode', () => {
    const left = createVideoItem({
      id: 'clip-left',
      from: 0,
      durationInFrames: 60,
    })
    const right = createVideoItem({
      id: 'clip-right',
      from: 40,
      durationInFrames: 60,
    })
    const transition: Transition = {
      id: 'transition-1',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: left.id,
      rightClipId: right.id,
      trackId: 'track-1',
      durationInFrames: 20,
      alignment: 0.5,
      createdAt: Date.now(),
    }

    expect(shouldForceContinuousPreviewOverlay([left, right], [transition], 47)).toBe(false)
  })

  it('forces continuous overlay during compound clip transitions in playback mode', () => {
    const left: TimelineItem = {
      id: 'compound-left',
      type: 'composition',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Compound',
      compositionId: 'sub-1',
      compositionWidth: 1920,
      compositionHeight: 1080,
    } as TimelineItem
    const right = createVideoItem({
      id: 'clip-right',
      from: 60,
      durationInFrames: 60,
    })
    const transition: Transition = {
      id: 'transition-compound',
      type: 'crossfade',
      presentation: 'fade',
      timing: 'linear',
      leftClipId: left.id,
      rightClipId: right.id,
      trackId: 'track-1',
      durationInFrames: 20,
      alignment: 0.5,
      createdAt: Date.now(),
    }

    expect(shouldForceContinuousPreviewOverlay([left, right], [transition], 55)).toBe(true)
    expect(shouldForceContinuousPreviewOverlay([left, right], [transition], 75)).toBe(false)
  })

  it('forces continuous overlay for enabled gpu effects on the active frame', () => {
    const effectedItem = createVideoItem({
      effects: [
        {
          id: 'effect-1',
          enabled: true,
          effect: {
            type: 'gpu-effect',
            gpuEffectType: 'gpu-blur',
            params: { amount: 0.5 },
          },
        },
      ],
    })

    expect(shouldForceContinuousPreviewOverlay([effectedItem], 0, 0)).toBe(true)
  })

  it('does not force continuous overlay for gpu effects on inactive clips', () => {
    const effectedItem = createVideoItem({
      effects: [
        {
          id: 'effect-1',
          enabled: true,
          effect: {
            type: 'gpu-effect',
            gpuEffectType: 'gpu-halftone',
            params: { amount: 0.5 },
          },
        },
      ],
    })

    expect(shouldForceContinuousPreviewOverlay([effectedItem], 0, 120)).toBe(false)
  })

  it('forces continuous overlay for non-normal blend modes on the active frame', () => {
    const blendedItem = createVideoItem({
      blendMode: 'screen',
    })

    expect(shouldForceContinuousPreviewOverlay([blendedItem], 0, 0)).toBe(true)
  })

  it('ignores stale blend modes on active shape masks', () => {
    const maskItem: TimelineItem = {
      id: 'mask-1',
      type: 'shape',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Mask',
      shapeType: 'path',
      isMask: true,
      blendMode: 'multiply',
    } as TimelineItem

    expect(shouldForceContinuousPreviewOverlay([maskItem], 0, 0)).toBe(false)
  })

  it('does not force continuous overlay for non-normal blend modes on inactive clips', () => {
    const blendedItem = createVideoItem({
      blendMode: 'screen',
    })

    expect(shouldForceContinuousPreviewOverlay([blendedItem], 0, 120)).toBe(false)
  })

  it('forces continuous overlay for active corner-pinned text', () => {
    const textItem: TimelineItem = {
      id: 'title-1',
      type: 'text',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Title',
      text: 'Headline',
      fontSize: 96,
      color: '#ffffff',
      cornerPin: {
        topLeft: [0, 0],
        topRight: [24, -8],
        bottomRight: [0, 0],
        bottomLeft: [-18, 12],
      },
    } as TimelineItem

    expect(shouldForceContinuousPreviewOverlay([textItem], 0, 0)).toBe(true)
    expect(shouldForceContinuousPreviewOverlay([textItem], 0, 120)).toBe(false)
  })

  it('forces continuous overlay only inside a text clip in/out motion window', () => {
    const motionText: TimelineItem = {
      id: 'motion-1',
      type: 'text',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Title',
      text: 'Tonight',
      fontSize: 96,
      color: '#ffffff',
      textMotion: {
        in: {
          presetId: 'fade-up',
          durationFrames: 12,
          staggerFrames: 0,
          intensity: 1,
          order: 'forward',
          easing: 'ease-out',
          seed: 0,
        },
      },
    } as TimelineItem

    // Inside the 12-frame in-window → overlay forced so the DOM Player never
    // renders the (unanimatable) motion frame.
    expect(shouldForceContinuousPreviewOverlay([motionText], 0, 3)).toBe(true)
    // Settled mid-clip → identity, no need for the overlay.
    expect(shouldForceContinuousPreviewOverlay([motionText], 0, 40)).toBe(false)
    // Past the clip entirely → inactive.
    expect(shouldForceContinuousPreviewOverlay([motionText], 0, 200)).toBe(false)
  })

  it('forces continuous overlay across the whole clip for a text loop motion', () => {
    const loopText: TimelineItem = {
      id: 'motion-loop-1',
      type: 'text',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 90,
      label: 'Title',
      text: 'Tonight',
      fontSize: 96,
      color: '#ffffff',
      textMotion: {
        loop: {
          presetId: 'wave',
          durationFrames: 30,
          staggerFrames: 3,
          intensity: 1,
          order: 'forward',
          easing: 'linear',
          seed: 0,
        },
      },
    } as TimelineItem

    expect(shouldForceContinuousPreviewOverlay([loopText], 0, 5)).toBe(true)
    expect(shouldForceContinuousPreviewOverlay([loopText], 0, 60)).toBe(true)
    expect(shouldForceContinuousPreviewOverlay([loopText], 0, 200)).toBe(false)
  })

  it('forces continuous overlay when an active compound clip has gpu effects on sub-items', () => {
    const compItem = createCompositionItem()
    const subComp = createSubComposition([
      {
        id: 'sub-item-1',
        type: 'video',
        trackId: 't',
        from: 0,
        durationInFrames: 120,
        label: 'v',
        src: 'blob:v',
        effects: [
          {
            id: 'e',
            enabled: true,
            effect: { type: 'gpu-effect', gpuEffectType: 'gpu-blur', params: { amount: 0.5 } },
          },
        ],
      } as TimelineItem,
    ])

    expect(
      shouldForceContinuousPreviewOverlay([compItem], 0, 0, undefined, { 'sub-1': subComp }),
    ).toBe(true)
  })

  it('forces continuous overlay when an active compound clip has corner-pinned sub-items', () => {
    const compItem = createCompositionItem()
    const subComp = createSubComposition([
      {
        id: 'sub-title-1',
        type: 'text',
        trackId: 't',
        from: 0,
        durationInFrames: 120,
        label: 'Title',
        text: 'Headline',
        fontSize: 96,
        color: '#ffffff',
        cornerPin: {
          topLeft: [0, 0],
          topRight: [18, -10],
          bottomRight: [0, 0],
          bottomLeft: [-12, 8],
        },
      } as TimelineItem,
    ])

    expect(
      shouldForceContinuousPreviewOverlay([compItem], 0, 0, undefined, { 'sub-1': subComp }),
    ).toBe(true)
  })

  it('ignores stale blend modes on sub-composition shape masks', () => {
    const compItem = createCompositionItem()
    const subComp = createSubComposition([
      {
        id: 'mask-1',
        type: 'shape',
        trackId: 't',
        from: 0,
        durationInFrames: 120,
        label: 'Mask',
        shapeType: 'path',
        isMask: true,
        blendMode: 'screen',
      } as TimelineItem,
    ])

    expect(
      shouldForceContinuousPreviewOverlay([compItem], 0, 0, undefined, { 'sub-1': subComp }),
    ).toBe(false)
  })

  it('forces continuous overlay when an active compound clip has adjustment-layer gpu effects', () => {
    const compItem = createCompositionItem()
    const subComp = createSubComposition([
      {
        id: 'adj-1',
        type: 'adjustment',
        trackId: 't',
        from: 0,
        durationInFrames: 120,
        label: 'adj',
        effects: [
          {
            id: 'e',
            enabled: true,
            effect: { type: 'gpu-effect', gpuEffectType: 'gpu-blur', params: { amount: 0.5 } },
          },
        ],
      } as TimelineItem,
    ])

    expect(
      shouldForceContinuousPreviewOverlay([compItem], 0, 0, undefined, { 'sub-1': subComp }),
    ).toBe(true)
  })

  it('does not force continuous overlay when compound clip is inactive', () => {
    const compItem: TimelineItem = {
      id: 'comp-1',
      type: 'composition',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 60,
      label: 'Comp',
      compositionId: 'sub-1',
      compositionWidth: 1920,
      compositionHeight: 1080,
    } as TimelineItem

    const subComp: SubComposition = {
      id: 'sub-1',
      name: 'Sub',
      fps: 30,
      width: 1920,
      height: 1080,
      durationInFrames: 60,
      tracks: [],
      transitions: [],
      keyframes: [],
      items: [
        {
          id: 'sub-item-1',
          type: 'video',
          trackId: 't',
          from: 0,
          durationInFrames: 60,
          label: 'v',
          src: 'blob:v',
          effects: [
            {
              id: 'e',
              enabled: true,
              effect: { type: 'gpu-effect', gpuEffectType: 'gpu-blur', params: { amount: 0.5 } },
            },
          ],
        } as TimelineItem,
      ],
    }

    expect(
      shouldForceContinuousPreviewOverlay([compItem], 0, 120, undefined, { 'sub-1': subComp }),
    ).toBe(false)
  })

  it('forces continuous overlay for preview-only gpu effects on the active frame', () => {
    const previewedItem = createVideoItem()

    expect(
      shouldForceContinuousPreviewOverlay(
        [previewedItem],
        0,
        0,
        new Map([
          [
            previewedItem.id,
            [
              {
                id: 'effect-preview',
                enabled: true,
                effect: {
                  type: 'gpu-effect',
                  gpuEffectType: 'gpu-sepia',
                  params: { amount: 0.8 },
                },
              },
            ],
          ],
        ]),
      ),
    ).toBe(true)
  })
})

describe('bounded continuous overlay routing', () => {
  const gpuEffect = {
    id: 'effect-window',
    enabled: true,
    effect: { type: 'gpu-effect' as const, gpuEffectType: 'gpu-blur', params: { amount: 0.5 } },
  }

  it('uses the exact frame while paused on an ordinary timeline', () => {
    expect(
      getContinuousPreviewOverlayFrameWindow({
        frame: 500,
        fps: 30,
        isPlaying: false,
        isPreviewing: false,
        playbackRate: 1,
      }),
    ).toEqual({ startFrame: 500, endFrameExclusive: 501 })
  })

  it('pre-arms forward playback and retains a short post-roll', () => {
    expect(
      getContinuousPreviewOverlayFrameWindow({
        frame: 500,
        fps: 30,
        isPlaying: true,
        isPreviewing: false,
        playbackRate: 1,
      }),
    ).toEqual({ startFrame: 497, endFrameExclusive: 509 })
  })

  it('puts the longer pre-arm window behind the playhead during reverse playback', () => {
    expect(
      getContinuousPreviewOverlayFrameWindow({
        frame: 500,
        fps: 30,
        isPlaying: true,
        isPreviewing: false,
        playbackRate: -1,
      }),
    ).toEqual({ startFrame: 492, endFrameExclusive: 504 })
  })

  it('activates for a one-frame effect inside the lookahead without routing distant frames', () => {
    const effected = createVideoItem({
      from: 508,
      durationInFrames: 1,
      effects: [gpuEffect],
    })

    expect(
      shouldForceContinuousPreviewOverlayInWindow([effected], 0, {
        startFrame: 497,
        endFrameExclusive: 509,
      }),
    ).toBe(true)
    expect(
      shouldForceContinuousPreviewOverlayInWindow([effected], 0, {
        startFrame: 0,
        endFrameExclusive: 9,
      }),
    ).toBe(false)
  })

  it('holds the rendered path across the end boundary, then releases it', () => {
    const effected = createVideoItem({
      from: 400,
      durationInFrames: 100,
      effects: [gpuEffect],
    })

    expect(
      shouldForceContinuousPreviewOverlayInWindow([effected], 0, {
        startFrame: 499,
        endFrameExclusive: 511,
      }),
    ).toBe(true)
    expect(
      shouldForceContinuousPreviewOverlayInWindow([effected], 0, {
        startFrame: 500,
        endFrameExclusive: 512,
      }),
    ).toBe(false)
  })
})

describe('timelineHasContinuousOverlayContent', () => {
  const gpuEffect = {
    id: 'effect-1',
    enabled: true,
    effect: { type: 'gpu-effect' as const, gpuEffectType: 'gpu-blur', params: { amount: 0.5 } },
  }

  it('is false for a timeline with no overlay-only content', () => {
    expect(timelineHasContinuousOverlayContent([createVideoItem()])).toBe(false)
  })

  it('is true when any item has an enabled GPU effect, regardless of frame position', () => {
    const effected = createVideoItem({ from: 500, durationInFrames: 60, effects: [gpuEffect] })
    expect(timelineHasContinuousOverlayContent([createVideoItem(), effected])).toBe(true)
  })

  it('ignores disabled effects', () => {
    const disabled = createVideoItem({ effects: [{ ...gpuEffect, enabled: false }] })
    expect(timelineHasContinuousOverlayContent([disabled])).toBe(false)
  })

  it('is true for a non-normal blend mode', () => {
    expect(timelineHasContinuousOverlayContent([createVideoItem({ blendMode: 'screen' })])).toBe(
      true,
    )
  })

  it('detects overlay-only content nested inside a sub-composition', () => {
    const subComp = createSubComposition([
      createVideoItem({ id: 'sub-item', effects: [gpuEffect] }),
    ])
    expect(
      timelineHasContinuousOverlayContent([createCompositionItem()], { 'sub-1': subComp }),
    ).toBe(true)
  })
})
