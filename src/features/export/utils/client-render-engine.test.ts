import { describe, expect, it } from 'vite-plus/test'
import type { TimelineItem } from '@/types/timeline'
import type { SubCompRenderData } from './canvas-item-renderer'
import { subCompositionRenderDataHasGpuEffects } from './client-render-engine'

function makeSubCompData(items: TimelineItem[]): SubCompRenderData {
  return {
    fps: 30,
    durationInFrames: 90,
    sortedTracks: [{ order: 0, visible: true, items }],
    keyframesMap: new Map(),
    adjustmentLayers: [],
  }
}

describe('subCompositionRenderDataHasGpuEffects', () => {
  it('detects GPU effects inside nested compound clips', () => {
    const nestedWrapper = {
      id: 'nested-wrapper',
      type: 'composition',
      compositionId: 'inner-comp',
    } as TimelineItem
    const innerVideo = {
      id: 'inner-video',
      type: 'video',
      effects: [
        {
          id: 'dither',
          enabled: true,
          effect: { type: 'gpu-effect', gpuEffectType: 'gpu-dither', params: {} },
        },
      ],
    } as TimelineItem
    const subCompRenderData = new Map<string, SubCompRenderData>([
      ['outer-comp', makeSubCompData([nestedWrapper])],
      ['inner-comp', makeSubCompData([innerVideo])],
    ])

    expect(subCompositionRenderDataHasGpuEffects('outer-comp', subCompRenderData)).toBe(true)
  })

  it('uses preview effect overrides while checking nested compounds', () => {
    const nestedWrapper = {
      id: 'nested-wrapper',
      type: 'composition',
      compositionId: 'inner-comp',
    } as TimelineItem
    const innerVideo = {
      id: 'inner-video',
      type: 'video',
      effects: [],
    } as unknown as TimelineItem
    const subCompRenderData = new Map<string, SubCompRenderData>([
      ['outer-comp', makeSubCompData([nestedWrapper])],
      ['inner-comp', makeSubCompData([innerVideo])],
    ])

    expect(
      subCompositionRenderDataHasGpuEffects('outer-comp', subCompRenderData, {
        getPreviewEffectsOverride: (itemId) =>
          itemId === 'inner-video'
            ? [
                {
                  id: 'preview-dither',
                  enabled: true,
                  effect: { type: 'gpu-effect', gpuEffectType: 'gpu-dither', params: {} },
                },
              ]
            : undefined,
      }),
    ).toBe(true)
  })
})
