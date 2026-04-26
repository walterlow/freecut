import { describe, expect, it } from 'vite-plus/test'
import { shouldForceContinuousPreviewOverlay } from './use-gpu-effects-overlay'
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

describe('shouldForceContinuousPreviewOverlay', () => {
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

  it('forces continuous overlay when an active compound clip has gpu effects on sub-items', () => {
    const compItem: TimelineItem = {
      id: 'comp-1',
      type: 'composition',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 120,
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
      durationInFrames: 120,
      tracks: [],
      transitions: [],
      keyframes: [],
      items: [
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
      ],
    }

    expect(
      shouldForceContinuousPreviewOverlay([compItem], 0, 0, undefined, { 'sub-1': subComp }),
    ).toBe(true)
  })

  it('ignores stale blend modes on sub-composition shape masks', () => {
    const compItem: TimelineItem = {
      id: 'comp-1',
      type: 'composition',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 120,
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
      durationInFrames: 120,
      tracks: [],
      transitions: [],
      keyframes: [],
      items: [
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
      ],
    }

    expect(
      shouldForceContinuousPreviewOverlay([compItem], 0, 0, undefined, { 'sub-1': subComp }),
    ).toBe(false)
  })

  it('forces continuous overlay when an active compound clip has adjustment-layer gpu effects', () => {
    const compItem: TimelineItem = {
      id: 'comp-1',
      type: 'composition',
      trackId: 'track-1',
      from: 0,
      durationInFrames: 120,
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
      durationInFrames: 120,
      tracks: [],
      transitions: [],
      keyframes: [],
      items: [
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
      ],
    }

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
